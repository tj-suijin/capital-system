import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { test } from 'node:test';
import { CONFIG } from '../config/portfolio.js';
import { NO_TRADE, TRADE } from '../src/buckets/intent.js';
import { LiquidDirectionalBucket } from '../src/buckets/liquidDirectional/liquidDirectionalBucket.js';
import { BucketRegistry } from '../src/buckets/registry.js';
import { Store, openStore } from '../src/persistence/db.js';
import { PortfolioManager } from '../src/portfolio/portfolioManager.js';
import { fakeClock, testConfig } from './helpers.js';

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 13, 12, 0, 30);
const LD = CONFIG.buckets.liquidDirectional;

const path = (n, f) => Array.from({ length: n }, (_, i) => f(i));

// Candles ending at the interval containing `now`.
function candles(closes, ms, now = NOW) {
  const last = Math.floor(now / ms) * ms;
  return closes.map((c, i) => {
    const prev = closes[i - 1] ?? c;
    return { ts: last - (closes.length - 1 - i) * ms, open: prev, high: Math.max(c, prev) * 1.0005, low: Math.min(c, prev) * 0.9995, close: c };
  });
}

const RANGE = path(220, i => 2500 * (1 + 0.004 * Math.sin(i / 3)));
// Steps of 0.2% stay under the fast-move filter's 0.4% minimum range.
function dip() {
  const c = path(100, i => 2500 * (1 + 0.002 * Math.sin(i / 3)));
  for (let k = 0; k < 6; k++) c.push(c.at(-1) * 0.998);
  return c;
}
function crossBelow() {
  const c = path(100, i => 2500 * 1.001 ** i);
  c.push(c.at(-1) * 0.97);
  return c;
}

class FakeMarket extends EventEmitter {
  constructor({ entry = dip(), regime = RANGE } = {}) {
    super();
    this.candles = { '1m': candles(entry, MIN), '5m': candles(regime, 5 * MIN) };
    this.lastPrice = entry.at(-1);
    this.lastTickAt = NOW;
    this.stale = false;
    this.failStart = null;
  }
  async start() { if (this.failStart) throw new Error(this.failStart); }
  async stop() {}
  isStale() { return this.stale; }
  getCandles(tf, limit) { return this.candles[tf].slice(-limit); }
  status() { return { fake: true }; }
}

async function makeBucket({ market = new FakeMarket(), trade = {} } = {}) {
  const config = { ...LD, trade: { ...LD.trade, ...trade } };
  const bucket = new LiquidDirectionalBucket({ id: 'liquidDirectional', config, market });
  await bucket.start();
  return { bucket, market };
}
const ctx = (now = NOW) => ({ now });

// ---- entries ----

test('LD bucket: ranging dip → mean-reversion intent with stop, target and tag', async () => {
  const { bucket, market } = await makeBucket();
  const r = await bucket.evaluate(ctx());
  assert.equal(r.type, TRADE);
  assert.equal(r.symbol, 'ETH/USDC');
  assert.equal(r.tag, 'mean_reversion');
  assert.equal(r.price, market.lastPrice);
  assert.ok(r.stopLossPct >= LD.trade.minStopPct && r.stopLossPct <= LD.trade.maxStopPct);
  assert.ok(r.takeProfitPct >= LD.trade.minTargetPct);
  assert.match(r.reason, /^mean_reversion \d+%: \[RANGING\]/);
});

test('LD bucket: stop distance is clamped to the configured range', async () => {
  const { bucket } = await makeBucket({ trade: { minStopPct: 0.01 } });
  assert.equal((await bucket.evaluate(ctx())).stopLossPct, 0.01);
  const { bucket: b2 } = await makeBucket({ trade: { minStopPct: 0.001, maxStopPct: 0.002 } });
  assert.equal((await b2.evaluate(ctx())).stopLossPct, 0.002);
});

test('LD bucket: no trade when the target does not cover costs or the stop is above price', async () => {
  const { bucket } = await makeBucket({ trade: { minTargetPct: 0.05 } });
  const r = await bucket.evaluate(ctx());
  assert.equal(r.type, NO_TRADE);
  assert.match(r.reason, /target .* below 5\.00% minimum/);

  const { bucket: b2, market } = await makeBucket();
  market.lastPrice *= 0.98; // price fell through the strategy's stop
  assert.match((await b2.evaluate(ctx())).reason, /is not below price/);
});

test('LD bucket: no trade on stale feed, gaps, warm-up, or market data down', async () => {
  const { bucket, market } = await makeBucket();
  market.stale = true;
  assert.equal((await bucket.evaluate(ctx())).reason, 'price feed stale');

  market.stale = false;
  market.candles['1m'].splice(-10, 1);
  assert.equal((await bucket.evaluate(ctx())).reason, 'gap in 1m candles');

  const { bucket: b2 } = await makeBucket({ market: new FakeMarket({ regime: RANGE.slice(0, 150) }) });
  assert.match((await b2.evaluate(ctx())).reason, /warming up \(150\/200 5m candles\)/);

  const { bucket: b3 } = await makeBucket({ market: new FakeMarket({ entry: dip() }) });
  assert.equal((await b3.evaluate(ctx(NOW + 10 * MIN))).reason, 'gap in 5m candles');

  const down = new FakeMarket();
  down.failStart = 'No RPC URL configured';
  const { bucket: b4 } = await makeBucket({ market: down, trade: { marketRetryMs: 3_600_000 } });
  const r = await b4.evaluate(ctx());
  assert.match(r.reason, /market data not running \(No RPC URL configured\)/);
  assert.equal(b4.status().ready, false);
  await b4.stop();
});

test('LD bucket: no entry during a fast move, including the forming candle, until enough calm candles pass', async () => {
  const { bucket, market } = await makeBucket();
  const m1 = market.candles['1m'];
  const forming = m1.at(-1);
  const saved = { ...forming };
  forming.low = forming.open * 0.992; // a 0.8% drop in the minute that is still forming
  const r = await bucket.evaluate(ctx());
  assert.equal(r.type, NO_TRADE);
  assert.match(r.reason, /^mean_reversion: fast move \(1m range 0\.\d\d%, limit 0\.\d\d%\), waiting for 5 calm candles$/);

  Object.assign(forming, saved);
  m1.at(-6).high = m1.at(-6).open * 1.006; // 5 calm candles after it: still blocked
  assert.equal((await bucket.evaluate(ctx())).type, NO_TRADE);
  m1.at(-6).high = saved.high;
  m1.at(-7).high = m1.at(-7).open * 1.006; // 6 calm candles after it: allowed
  assert.equal((await bucket.evaluate(ctx())).type, TRADE);
});

test('LD bucket: volatility is the larger range of the newest two 1m candles', async () => {
  const { bucket, market } = await makeBucket();
  const [a, b] = market.candles['1m'].slice(-2);
  assert.equal(bucket.volatilityPct(), Math.max((a.high - a.low) / a.open, (b.high - b.low) / b.open));
  await bucket.stop();
  assert.equal(bucket.volatilityPct(), null);
});

test('LD bucket: paperMinConfidence applies only in paper mode', async () => {
  const paper = new LiquidDirectionalBucket({ id: 'liquidDirectional', config: LD, market: new FakeMarket() });
  assert.equal(paper.params.minConfidence, LD.strategy.paperMinConfidence);
  assert.equal(paper.status().minConfidence, LD.strategy.paperMinConfidence);
  for (const mode of ['shadow', 'live']) {
    const b = new LiquidDirectionalBucket({ id: 'liquidDirectional', config: { ...LD, mode }, market: new FakeMarket() });
    assert.equal(b.params.minConfidence, LD.strategy.minConfidence);
  }
  assert.ok(LD.strategy.paperMinConfidence < LD.strategy.minConfidence);
});

// ---- exits ----

const pos = (over = {}) => ({ id: 1, stop_loss: null, take_profit: null, tag: 'mean_reversion', opened_at: NOW - MIN, ...over });

test('LD bucket: exits on stop, target, the opening strategy\'s signal, and time limit', async () => {
  const { bucket, market } = await makeBucket();
  const p = market.lastPrice;
  const exits = await bucket.reviewPositions([
    pos({ id: 1, stop_loss: p * 1.001 }),
    pos({ id: 2, take_profit: p * 0.999 }),
    pos({ id: 3, opened_at: NOW - LD.trade.maxHoldMs }),
    pos({ id: 4 }),
  ], ctx());
  assert.deepEqual(exits.map(e => [e.positionId, e.reason.split(' ')[0]]), [[1, 'stop'], [2, 'take'], [3, 'time']]);
  assert.ok(exits.every(e => e.price === p));

  const { bucket: b2 } = await makeBucket({ market: new FakeMarket({ entry: crossBelow() }) });
  const [e] = await b2.reviewPositions([pos({ tag: 'trend_following' }), pos({ id: 2, tag: 'mean_reversion' })], ctx());
  assert.equal(e.positionId, 1);
  assert.match(e.reason, /^trend_following exit: price crossed below EMA20/);
});

test('LD bucket: no exits are requested without a live price', async () => {
  const { bucket, market } = await makeBucket();
  market.stale = true;
  assert.deepEqual(await bucket.reviewPositions([pos({ stop_loss: 1e9 })], ctx()), []);
});

test('LD bucket: before the first live swap it says so, and reports itself unhealthy', async () => {
  const { bucket, market } = await makeBucket();
  assert.deepEqual(bucket.health(NOW), { ok: true, reason: null, lastTickAt: NOW, reconnects: 0 });
  assert.deepEqual(bucket.livePrice(NOW), { price: market.lastPrice, ts: NOW });

  market.lastTickAt = null;
  assert.equal((await bucket.evaluate(ctx())).reason, 'waiting for first live swap');
  assert.equal(bucket.health(NOW).ok, false);
  assert.equal(bucket.livePrice(NOW), null);
  assert.deepEqual(await bucket.reviewPositions([pos({ stop_loss: 1e9 })], ctx()), []);
});

// ---- mark price ----

test('LD bucket: marks at the last live swap, falls back to the newest candle, ignores other symbols', async () => {
  const { bucket, market } = await makeBucket();
  assert.deepEqual(bucket.markPrice('ETH/USDC'), { price: market.lastPrice, ts: NOW });
  assert.equal(bucket.markPrice('BONK/SOL'), null);

  market.lastTickAt = null;
  const last = market.candles['1m'].at(-1);
  assert.deepEqual(bucket.markPrice('ETH/USDC'), { price: last.close, ts: last.ts });

  market.candles['1m'] = [];
  assert.equal(bucket.markPrice('ETH/USDC'), null);
});

// ---- through the portfolio pipeline ----

test('LD bucket: paper position opens through the pipeline and closes at its stop', async () => {
  const config = { ...testConfig(), buckets: { liquidDirectional: { ...LD, allocationPct: 0.60 } } };
  const store = openStore();
  const market = new FakeMarket();
  const bucket = new LiquidDirectionalBucket({ id: 'liquidDirectional', config: config.buckets.liquidDirectional, market });
  const registry = new BucketRegistry().register(bucket);
  const pm = new PortfolioManager({ config, store, registry, clock: fakeClock(NOW) });
  pm.init();
  await bucket.start();

  await pm.runBucketCycle('liquidDirectional');
  const [open] = store.getOpenPositions('liquidDirectional');
  assert.ok(open, 'a position was opened');
  assert.equal(open.tag, 'mean_reversion');
  assert.ok(open.stop_loss < open.entry_price && open.take_profit > open.entry_price);
  assert.equal(store.getRecentDecisions(1, 'liquidDirectional')[0].outcome, 'APPROVED');

  const [marked] = pm.openPositions('liquidDirectional');
  assert.equal(marked.markPrice, market.lastPrice);
  assert.ok(Math.abs(marked.unrealizedPnlUsd - (open.qty * market.lastPrice - open.notional_usd - open.open_fee_usd)) < 1e-9);

  market.lastPrice = open.stop_loss * 0.999;
  await pm.runBucketCycle('liquidDirectional');
  const closed = store.getPosition(open.id);
  assert.equal(closed.status, 'closed');
  assert.match(closed.exit_reason, /^stop loss/);
  assert.ok(closed.pnl_usd < 0);
});

test('LD bucket: a swap past the stop closes the position between cycles', async () => {
  const config = { ...testConfig(), buckets: { liquidDirectional: { ...LD, allocationPct: 0.60 } } };
  const store = openStore();
  const market = new FakeMarket();
  const bucket = new LiquidDirectionalBucket({ id: 'liquidDirectional', config: config.buckets.liquidDirectional, market });
  const pm = new PortfolioManager({ config, store, registry: new BucketRegistry().register(bucket), clock: fakeClock(NOW) });
  pm.init();
  await bucket.start();
  await pm.runBucketCycle('liquidDirectional');
  const [open] = store.getOpenPositions('liquidDirectional');

  const off = bucket.subscribePrices(t => pm.onPriceTick('liquidDirectional', t));
  market.emit('price', { price: open.stop_loss * 1.0001, ts: NOW });
  await new Promise(setImmediate);
  assert.equal(store.getPosition(open.id).status, 'open');
  market.emit('price', { price: open.stop_loss * 0.9999, ts: NOW });
  await new Promise(setImmediate);
  const closed = store.getPosition(open.id);
  assert.equal(closed.status, 'closed');
  assert.match(closed.exit_reason, /^stop loss/);
  off();
  assert.equal(market.listenerCount('price'), 0);
});

// ---- restart with an open position ----

test('LD bucket: after a restart, open positions keep their stops and the time limit still applies', async t => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'cs-restart-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = nodePath.join(dir, 'capital.db');
  // Two entries in a row, so the spacing and losing-position rules are off here.
  const risk = { ...LD.risk, minEntrySpacingMs: 0, noEntryWhileLosing: false };
  const config = { ...testConfig(), buckets: { liquidDirectional: { ...LD, allocationPct: 0.60, risk } } };
  const boot = async (clock, market = new FakeMarket()) => {
    const store = new Store(dbPath);
    const bucket = new LiquidDirectionalBucket({ id: 'liquidDirectional', config: config.buckets.liquidDirectional, market });
    const pm = new PortfolioManager({ config, store, registry: new BucketRegistry().register(bucket), clock });
    pm.init();
    await bucket.start();
    return { store, pm, market };
  };

  // First process: opens two positions, then dies without stop().
  const a = await boot(fakeClock(NOW));
  await a.pm.runBucketCycle('liquidDirectional');
  await a.pm.runBucketCycle('liquidDirectional');
  const before = a.store.getOpenPositions();
  assert.equal(before.length, 2);
  const ledgerBefore = a.store.getLedger('liquidDirectional');
  a.store.close();

  // Second process, 5 hours later: the price sits between stop and target,
  // so only the 4-hour limit can close them.
  const b = await boot(fakeClock(NOW + 5 * 3_600_000));
  assert.deepEqual(b.store.getOpenPositions().map(p => p.id), before.map(p => p.id));
  assert.deepEqual(b.store.getLedger('liquidDirectional'), ledgerBefore);
  b.market.stale = true;
  await b.pm.runBucketCycle('liquidDirectional');
  assert.equal(b.store.getOpenPositions().length, 2, 'no exits without a live price');

  b.market.stale = false;
  await b.pm.runBucketCycle('liquidDirectional');
  const closed = before.map(p => b.store.getPosition(p.id));
  assert.ok(closed.every(p => p.status === 'closed' && /^time limit/.test(p.exit_reason)), closed.map(p => p.exit_reason).join(', '));

  const l = b.store.getLedger('liquidDirectional');
  assert.ok(Math.abs(l.in_use_usd - b.store.getOpenPositions().reduce((n, p) => n + p.notional_usd, 0)) < 1e-6);
  assert.ok(Math.abs(l.cash_usd + l.in_use_usd - (l.allocated_usd + l.realized_pnl_usd)) < 1e-6);
  b.store.close();
});
