// PortfolioManager — the top level. Runs each bucket on its own interval and
// pushes every intent through the same pipeline:
//
//   bucket.evaluate → sizer → bucket risk → global risk → allocator → executor
//
// Every outcome (NO_TRADE, REJECTED, SHADOW, APPROVED, ERROR) is written to the
// decisions table and emitted on the event bus. Process starts and stops,
// halts, operator actions and health alerts go to system_events.
//
// Events: 'decision', 'fill', 'close', 'risk', 'heartbeat', 'control', 'alert'
import { EventEmitter } from 'node:events';
import { RESERVE_ID } from '../../config/portfolio.js';
import { NO_TRADE, TRADE } from '../buckets/intent.js';
import { PaperExecutor } from '../execution/paperExecutor.js';
import { BucketRisk } from '../risk/bucketRisk.js';
import { GlobalRiskEngine } from '../risk/globalRisk.js';
import { sizePosition } from '../risk/positionSizer.js';
import { E, TradingError } from '../shared/errors.js';
import { createLogger, onLogError } from '../shared/logger.js';
import { CapitalAllocator } from './capitalAllocator.js';
import { HealthMonitor } from './healthMonitor.js';
import { markPosition, sumMarks } from './valuation.js';

const DAY = 24 * 60 * 60 * 1000;

export const OUTCOME = {
  NO_TRADE: 'NO_TRADE',
  REJECTED: 'REJECTED',
  SHADOW:   'SHADOW',
  APPROVED: 'APPROVED',
  ERROR:    'ERROR',
};

export class PortfolioManager {
  /**
   * @param {object} opts
   * @param {object} opts.config
   * @param {Store}  opts.store
   * @param {BucketRegistry} opts.registry
   * @param {object} [opts.liveAdapters] — { [bucketId]: ExecutionAdapter } (none exist in step 1)
   * @param {Function} [opts.clock]
   */
  constructor({ config, store, registry, liveAdapters = {}, clock = Date.now }) {
    this.config       = config;
    this.store        = store;
    this.registry     = registry;
    this.liveAdapters = liveAdapters;
    this.clock        = clock;
    this.events       = new EventEmitter();
    this.log          = createLogger('PORTFOLIO');

    this.allocator  = new CapitalAllocator({
      store, config, clock,
      unrealized: bucketId => sumMarks(this.openPositions(bucketId)).unrealizedPnlUsd,
    });
    this.bucketRisk = new BucketRisk({ store, config, clock });
    this.globalRisk = new GlobalRiskEngine({
      store, config, clock,
      getEquity:        () => this.allocator.totalEquity(),
      getGrossExposure: () => {
        const m = sumMarks(this.openPositions());
        return this.allocator.totalInUse() + m.valueUsd - m.notionalUsd;
      },
      onHalt:           e => {
        this._record('HALT', null, e);
        this.events.emit('risk', { type: 'HALT', ...e, ts: this.clock() });
      },
    });
    this.health = new HealthMonitor({
      config: config.alerts, store, clock,
      emit:   (event, payload) => this.events.emit(event, payload),
    });

    this.paperExecutor = new PaperExecutor(config.paper);
    this.executors     = new Map(); // bucketId → adapter (null for shadow)
    this.windingDown   = false;
    this._timers       = [];
    this._busy         = new Set();
    this._initialized  = false;
    this._offErrors    = null;
    this.running       = false;
    this.startInfo     = null;
  }

  // Ledgers, persisted state and live gating. Safe to call without start().
  init() {
    if (this._initialized) return;
    this.allocator.init();
    this.windingDown = this.store.getSetting('windingDown') === '1';

    const now = this.clock();
    for (const bucket of this.registry.list()) {
      if (!this.config.buckets[bucket.id]) throw new Error(`Bucket "${bucket.id}" has no config block`);
      this.executors.set(bucket.id, this._resolveExecutor(bucket));
      this.store.upsertBucket({ id: bucket.id, name: bucket.name, mode: bucket.mode, enabled: true }, now);
    }
    this.globalRisk.refresh();
    this._initialized = true;
  }

  async start() {
    this.init();
    this.startInfo  = this._recordStart();
    this._offErrors = onLogError(e => this.health.onError(e));
    for (const bucket of this.registry.list()) {
      await bucket.start(this._ctx(bucket));
      const every = this.config.buckets[bucket.id].evaluateIntervalMs;
      this._timers.push(setInterval(() => this.runBucketCycle(bucket.id), every));
      this.log.info({ bucket: bucket.id, mode: bucket.mode, everyMs: every }, 'Bucket started');
    }
    this._timers.push(setInterval(() => this.heartbeat(), this.config.heartbeatIntervalMs));
    this.running = true;
    this.heartbeat();
    for (const bucket of this.registry.list()) await this.runBucketCycle(bucket.id);
    this.log.info({ mode: this.config.mode, buckets: this.registry.list().length }, 'Portfolio manager running');
  }

  async stop() {
    for (const t of this._timers) clearInterval(t);
    this._timers = [];
    for (const bucket of this.registry.list()) await bucket.stop();
    this._offErrors?.();
    this._offErrors = null;
    if (this.startInfo) {
      this.store.setSetting('cleanShutdown', '1', this.clock());
      this._record('STOP', null, { pid: process.pid });
      this.startInfo = null;
    }
    this.running = false;
    this.log.info('Portfolio manager stopped');
  }

  // ------------------------------------------------------------ run state

  // previousExit: 'first' (new database), 'clean' (stop() ran) or 'unclean'
  // (crash, kill or reboot). The run window starts at the first ever start.
  _recordStart() {
    const now = this.clock();
    const flag = this.store.getSetting('cleanShutdown');
    const previousExit = flag == null ? 'first' : flag === '1' ? 'clean' : 'unclean';
    this.store.setSetting('cleanShutdown', '0', now);
    if (this.store.getSetting('runStartedAt') == null) this.store.setSetting('runStartedAt', now, now);
    const info = { previousExit, pid: process.pid, openPositions: this.store.getOpenPositions().length };
    this._record('START', null, info);
    if (previousExit === 'unclean') this.log.warn({ previousExit, openPositions: info.openPositions }, 'Previous run did not shut down cleanly');
    return info;
  }

  runInfo() {
    const now       = this.clock();
    const raw       = this.store.getSetting('runStartedAt');
    const startedAt = raw == null ? null : Number(raw);
    const days      = this.config.paperRun?.days ?? null;
    if (startedAt == null) return { startedAt: null, days, day: null, endsAt: null, complete: false };
    const endsAt = days ? startedAt + days * DAY : null;
    return { startedAt, days, day: Math.floor((now - startedAt) / DAY) + 1, endsAt, complete: endsAt != null && now >= endsAt };
  }

  // ---------------------------------------------------------------- cycle

  async runBucketCycle(bucketId) {
    const bucket = this.registry.get(bucketId);
    if (!bucket) throw new TradingError(E.PM_UNKNOWN_BUCKET, bucketId);
    if (this._busy.has(bucketId)) return;
    this._busy.add(bucketId);
    try {
      await this._reviewExits(bucket);
      await this._evaluateEntry(bucket);
      this.globalRisk.refresh(); // marks move every cycle, so drawdown is checked every cycle
    } catch (err) {
      this.log.error({ bucket: bucketId, err: err.message }, 'Bucket cycle failed');
      this._decide(bucket, OUTCOME.ERROR, 'bucket', null, err.message, null);
    } finally {
      this._busy.delete(bucketId);
    }
    try {
      this.health.checkBucket(bucket, this.clock());
    } catch (err) {
      this.log.error({ bucket: bucketId, err: err.message }, 'Health check failed');
    }
  }

  async _reviewExits(bucket) {
    const open = this.store.getOpenPositions(bucket.id);
    if (!open.length) return;
    const requests = await bucket.reviewPositions(open, this._ctx(bucket));
    for (const req of requests ?? []) {
      await this.closePosition(req.positionId, req.price, req.reason);
    }
  }

  async _evaluateEntry(bucket) {
    const result = await bucket.evaluate(this._ctx(bucket));
    if (!result || result.type === NO_TRADE) {
      this._decide(bucket, OUTCOME.NO_TRADE, 'bucket', null, result?.reason ?? 'no setup', null);
      return;
    }
    if (result.type !== TRADE) throw new Error(`Bucket returned unknown result type: ${result.type}`);
    await this.processIntent(bucket.id, result);
  }

  // Exposed for tests and future manual tooling.
  async processIntent(bucketId, intent) {
    const bucket = this.registry.get(bucketId);
    const reject = (stage, def, reason) => this._decide(bucket, OUTCOME.REJECTED, stage, def?.code ?? def, reason, intent);

    if (this.globalRisk.isHalted()) return reject('portfolio', E.PM_HALTED, E.PM_HALTED.msg);
    if (this.windingDown)          return reject('portfolio', E.PM_WINDING_DOWN, E.PM_WINDING_DOWN.msg);

    const lim       = this.config.buckets[bucketId].risk;
    const ledger    = this.allocator.ledger(bucketId);
    const equityUsd = this.allocator.equity(bucketId);
    const size = sizePosition({
      bucketEquityUsd:        equityUsd,
      availableCashUsd:       ledger.cash_usd,
      maxPositionPctOfBucket: lim.maxPositionPctOfBucket,
      maxRiskPerTradePct:     lim.maxRiskPerTradePct,
      confidence:             intent.confidence,
      stopLossPct:            intent.stopLossPct,
      requestedUsd:           intent.requestedUsd,
    });
    if (size <= 0) return reject('sizer', E.SIZE_ZERO, E.SIZE_ZERO.msg);

    const br = this.bucketRisk.checkEntry(bucketId, size, { bucketEquityUsd: equityUsd, allocatedUsd: ledger.allocated_usd });
    if (!br.ok) return reject('bucket_risk', br.code, br.reason);

    const gr = this.globalRisk.checkEntry(size);
    if (!gr.ok) return reject('global_risk', gr.code, gr.reason);

    const sized = { ...intent, sizeUsd: size };
    const executor = this.executors.get(bucketId);
    if (!executor) {
      return this._decide(bucket, OUTCOME.SHADOW, 'shadow', null, `would open $${size.toFixed(2)} ${intent.symbol}`, sized);
    }

    const res = this.allocator.reserve(bucketId, size);
    if (!res.ok) return reject('allocator', res.code, res.reason);

    let fill;
    try {
      fill = await executor.open({ bucketId, symbol: intent.symbol, side: intent.side, price: intent.price, notionalUsd: size });
    } catch (err) {
      this.allocator.release(bucketId, size, 0);
      this.log.error({ bucket: bucketId, code: E.EXEC_FAILED.code, err: err.message }, 'Open failed');
      return reject('executor', err.code ?? E.EXEC_FAILED.code, err.message);
    }

    // Stops and targets are anchored to the market price the bucket saw, not
    // the fill, so a fill's slippage does not move them.
    const now = this.clock();
    const positionId = this.store.insertPosition({
      bucketId,
      symbol:      intent.symbol,
      side:        intent.side,
      mode:        executor.isLive ? 'live' : 'paper',
      venue:       fill.venue ?? executor.venue,
      entryPrice:  fill.fillPrice,
      qty:         fill.qty,
      notionalUsd: size,
      openFeeUsd:  fill.feeUsd,
      stopLoss:    intent.stopLossPct ? intent.price * (1 - intent.stopLossPct) : null,
      takeProfit:  intent.takeProfitPct ? intent.price * (1 + intent.takeProfitPct) : null,
      reason:      intent.reason,
      tag:         intent.tag,
      openedAt:    now,
    });
    this.store.insertTrade({
      positionId, bucketId, action: 'OPEN', price: fill.fillPrice, qty: fill.qty,
      notionalUsd: size, feeUsd: fill.feeUsd, mode: executor.isLive ? 'live' : 'paper', ts: now,
    });

    this._decide(bucket, OUTCOME.APPROVED, 'executor', null, `opened $${size.toFixed(2)} ${intent.symbol}`, { ...sized, positionId });
    const position = this.store.getPosition(positionId);
    this.log.info({ bucket: bucketId, positionId, symbol: intent.symbol, sizeUsd: size, price: fill.fillPrice }, 'Position opened');
    this.events.emit('fill', { bucketId, position, ts: now });
    bucket.onFill(position);
    return position;
  }

  // Closing is always allowed — halts and pauses never block exits.
  async closePosition(positionId, price, reason) {
    const position = this.store.getPosition(positionId);
    if (!position || position.status !== 'open') return null;

    const bucket   = this.registry.get(position.bucket_id);
    const executor = this.executors.get(position.bucket_id) ?? this.paperExecutor;
    const fill     = await executor.close({ position, price });

    const pnlUsd = fill.proceedsUsd - position.notional_usd - position.open_fee_usd - fill.feeUsd;
    const now    = this.clock();
    this.store.closePosition(positionId, { exitPrice: fill.fillPrice, closeFeeUsd: fill.feeUsd, pnlUsd, exitReason: reason, closedAt: now });
    this.store.insertTrade({
      positionId, bucketId: position.bucket_id, action: 'CLOSE', price: fill.fillPrice, qty: position.qty,
      notionalUsd: fill.proceedsUsd, feeUsd: fill.feeUsd, mode: position.mode, ts: now,
    });
    this.allocator.release(position.bucket_id, position.notional_usd, pnlUsd);

    const closed = this.store.getPosition(positionId);
    this.log.info({ bucket: position.bucket_id, positionId, pnlUsd, reason }, 'Position closed');
    this.events.emit('close', { bucketId: position.bucket_id, position: closed, pnlUsd, ts: now });
    bucket?.onClose(closed);
    this.globalRisk.refresh();
    return closed;
  }

  // ------------------------------------------------------------ heartbeat

  heartbeat() {
    const ts = this.clock();
    const risk = this.globalRisk.refresh();
    const summary = this.allocator.summary();
    for (const l of summary) {
      this.store.insertEquitySnapshot({ bucketId: l.bucketId, equityUsd: l.equityUsd, cashUsd: l.cashUsd, inUseUsd: l.inUseUsd, realizedPnlUsd: l.realizedPnlUsd, unrealizedPnlUsd: l.unrealizedPnlUsd, ts });
    }
    const totals = summary.reduce((a, l) => ({
      cashUsd: a.cashUsd + l.cashUsd, inUseUsd: a.inUseUsd + l.inUseUsd,
      realizedPnlUsd: a.realizedPnlUsd + l.realizedPnlUsd, unrealizedPnlUsd: a.unrealizedPnlUsd + l.unrealizedPnlUsd,
    }), { cashUsd: 0, inUseUsd: 0, realizedPnlUsd: 0, unrealizedPnlUsd: 0 });
    this.store.insertEquitySnapshot({ bucketId: 'portfolio', equityUsd: risk.equity, ...totals, ts });

    const counts = this.store.decisionCountsSince(ts - this.config.heartbeatIntervalMs);
    const mem    = process.memoryUsage();
    const feeds  = {};
    for (const b of this.registry.list()) {
      const h = b.health(ts);
      if (h.reconnects != null || !h.ok) {
        feeds[b.id] = { ok: h.ok, reconnects: h.reconnects ?? null, lastTickAgeS: h.lastTickAt != null ? Math.round((ts - h.lastTickAt) / 1000) : null };
      }
    }
    this.log.info({
      equityUsd: +risk.equity.toFixed(2), unrealizedPnlUsd: +totals.unrealizedPnlUsd.toFixed(2),
      drawdownPct: +(risk.drawdownPct * 100).toFixed(2), halted: this.globalRisk.isHalted(), decisions: counts,
      rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576), feeds,
    }, 'Heartbeat');
    this.events.emit('heartbeat', { ts, equityUsd: risk.equity, drawdownPct: risk.drawdownPct, decisions: counts });
  }

  // ------------------------------------------------------------- controls

  pauseBucket(bucketId, reason) {
    this._requireBucket(bucketId);
    this.bucketRisk.pause(bucketId, reason);
    this._control('PAUSE', bucketId, { reason });
  }

  resumeBucket(bucketId) {
    this._requireBucket(bucketId);
    this.bucketRisk.resume(bucketId);
    this._control('RESUME', bucketId);
  }

  setWindDown(on = true) {
    this.windingDown = !!on;
    this.store.setSetting('windingDown', on ? '1' : '0', this.clock());
    this.log.warn({ windingDown: this.windingDown }, 'Wind-down toggled');
    this._control(on ? 'WIND_DOWN' : 'WIND_DOWN_OFF');
  }

  halt(reason = 'operator halt') {
    this.globalRisk.halt(reason, E.PM_HALTED.code);
  }

  unhalt() {
    this.globalRisk.unhalt();
    this._control('UNHALT');
  }

  _control(type, bucketId = null, detail = {}) {
    this._record(type, bucketId, detail);
    this.events.emit('control', { type, ...(bucketId ? { bucketId } : {}), ...detail, ts: this.clock() });
  }

  _record(type, bucketId, detail) {
    this.store.insertEvent({ type, bucketId, detail, ts: this.clock() });
  }

  // ------------------------------------------------------------ valuation

  // Open positions with their current mark (see valuation.js).
  openPositions(bucketId = null) {
    const now = this.clock();
    return this.store.getOpenPositions(bucketId).map(p => markPosition(p, this._mark(p, now), now));
  }

  _mark(position, now) {
    const bucket = this.registry.get(position.bucket_id);
    if (!bucket) return null;
    try {
      return bucket.markPrice(position.symbol, now);
    } catch (err) {
      this.log.error({ bucket: bucket.id, positionId: position.id, code: E.MARK_FAILED.code, err: err.message }, E.MARK_FAILED.msg);
      return null;
    }
  }

  // --------------------------------------------------------------- status

  status() {
    const ledgers = Object.fromEntries(this.allocator.summary().map(l => [l.bucketId, l]));
    const dayAgo  = this.clock() - 24 * 60 * 60 * 1000;
    const buckets = this.registry.list().map(b => {
      const pause = this.bucketRisk.pauseState(b.id);
      return {
        id:            b.id,
        name:          b.name,
        mode:          b.mode,
        executor:      this.executors.get(b.id)?.venue ?? 'none (shadow)',
        paused:        pause.paused,
        pauseReason:   pause.reason,
        ...ledgers[b.id],
        openPositions: this.store.getOpenPositions(b.id).length,
        decisions24h:  this.store.decisionCountsSince(dayAgo, b.id),
        lastDecision:  this.store.getRecentDecisions(1, b.id)[0] ?? null,
        detail:        b.status(),
      };
    });
    return {
      mode:        this.config.mode,
      running:     this.running,
      windingDown: this.windingDown,
      risk:        this.globalRisk.status(),
      reserve:     ledgers[RESERVE_ID] ?? null,
      buckets,
    };
  }

  // -------------------------------------------------------------- helpers

  _resolveExecutor(bucket) {
    const cfg = this.config.buckets[bucket.id];
    if (bucket.mode === 'shadow') return null;
    if (bucket.mode === 'paper')  return this.paperExecutor;
    if (bucket.mode !== 'live')   throw new Error(`Bucket "${bucket.id}" has invalid mode "${bucket.mode}"`);

    const adapter = this.liveAdapters[bucket.id];
    const problems = [];
    if (this.config.mode !== 'live') problems.push('TRADING_MODE is not "live"');
    if (cfg.live !== true)           problems.push('bucket config live !== true');
    if (cfg.paperOnly)               problems.push('bucket is paperOnly');
    if (!adapter?.isLive)            problems.push('no live execution adapter registered');
    if (problems.length) {
      throw new TradingError(E.PM_LIVE_GATE, `${bucket.id}: ${problems.join('; ')}`);
    }
    this.log.warn({ bucket: bucket.id, venue: adapter.venue }, 'LIVE execution enabled for bucket');
    return adapter;
  }

  _requireBucket(bucketId) {
    if (!this.registry.get(bucketId)) throw new TradingError(E.PM_UNKNOWN_BUCKET, bucketId);
  }

  _ctx(bucket) {
    const ledger = this.allocator.ledger(bucket.id);
    return {
      now:           this.clock(),
      bucketId:      bucket.id,
      mode:          bucket.mode,
      availableUsd:  ledger.cash_usd,
      equityUsd:     this.allocator.equity(bucket.id),
      openPositions: this.store.getOpenPositions(bucket.id),
    };
  }

  _decide(bucket, outcome, stage, code, reason, intent) {
    const ts = this.clock();
    const id = this.store.insertDecision({ bucketId: bucket.id, outcome, stage, code, reason, intent, ts });
    const decision = { id, bucketId: bucket.id, outcome, stage, code, reason, intent, ts };
    if (outcome === OUTCOME.REJECTED) this.log.info({ bucket: bucket.id, stage, code, reason }, 'Intent rejected');
    else this.log.debug({ bucket: bucket.id, outcome, reason }, 'Decision');
    this.events.emit('decision', decision);
    return decision;
  }
}

export default PortfolioManager;
