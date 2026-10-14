// LiquidDirectional — bucket 1. ETH/USDC spot longs on Uniswap V3 (Base),
// using the regime detector and the two strategies from trading-bot.
//
// Entry: no trade unless market data is running, fresh and gap-free, the
//   analyst proposes an entry, its stop is below the price, and its target
//   (if any) is far enough away to cover costs. Stop distance is clamped to
//   [minStopPct, maxStopPct].
// Exit (checked every cycle, at the current pool price):
//   stop loss, take profit, the opening strategy's exit signal, max hold time.
//   With a stale price feed no exit is requested, because there is no
//   trustworthy price to fill at.
import { isContiguous } from '../../data/candleBuilder.js';
import { createLogger } from '../../shared/logger.js';
import { Bucket } from '../bucket.js';
import { closeRequest, noTrade, tradeIntent } from '../intent.js';
import { analyze } from './analyst.js';

export class LiquidDirectionalBucket extends Bucket {
  /**
   * @param {object} opts
   * @param {string} opts.id
   * @param {object} opts.config  — config.buckets.liquidDirectional
   * @param {MarketData} opts.market
   */
  constructor({ id, config, market }) {
    super({ id, config });
    this.market   = market;
    // paperMinConfidence applies only to paper fills; shadow and live keep minConfidence.
    const s = config.strategy;
    this.params   = this.mode === 'paper' && s.paperMinConfidence != null ? { ...s, minConfidence: s.paperMinConfidence } : s;
    this.trade    = config.trade;
    this.tfMs     = config.market.timeframes;
    this.log      = createLogger('BUCKET:LD');
    this.ready    = false;
    this.startErr = null;
    this._retry   = null;
    this._view    = null;   // { now, view }
  }

  async start() {
    await this._startMarket();
  }

  async stop() {
    clearTimeout(this._retry);
    this._retry = null;
    if (this.ready) await this.market.stop();
    this.ready = false;
  }

  async _startMarket() {
    try {
      await this.market.start();
      this.ready = true;
      this.startErr = null;
    } catch (err) {
      this.startErr = err.message;
      this.log.error({ code: err.code, err: err.message, retryMs: this.trade.marketRetryMs }, 'Market data failed to start — bucket will answer no-trade');
      try { await this.market.stop(); } catch { /* partial start */ }
      this._retry = setTimeout(() => this._startMarket(), this.trade.marketRetryMs);
    }
  }

  // ---------------------------------------------------------------- entry

  async evaluate(ctx) {
    const blocked = this._dataProblem(ctx.now);
    if (blocked) return noTrade(blocked);

    const view = this._analyze(ctx.now);
    if (!view.entry) return noTrade(view.noTradeReason);

    const e = view.entry;
    const price = this.market.lastPrice;
    if (e.stopLoss == null || !(e.stopLoss < price)) {
      return noTrade(`${e.strategy}: stop ${e.stopLoss?.toFixed(2) ?? 'missing'} is not below price ${price.toFixed(2)}`);
    }
    const rawStop = (price - e.stopLoss) / price;
    const stopLossPct = Math.min(this.trade.maxStopPct, Math.max(this.trade.minStopPct, rawStop));

    let takeProfitPct = null;
    if (e.targetPrice != null) {
      takeProfitPct = (e.targetPrice - price) / price;
      if (takeProfitPct < this.trade.minTargetPct) {
        return noTrade(`${e.strategy}: target ${(takeProfitPct * 100).toFixed(2)}% away, below ${(this.trade.minTargetPct * 100).toFixed(2)}% minimum`);
      }
    }

    return tradeIntent({
      symbol:     this.trade.symbol,
      price,
      confidence: e.confidence,
      stopLossPct,
      takeProfitPct,
      tag:        e.strategy,
      reason:     `${e.strategy} ${(e.confidence * 100).toFixed(0)}%: ${e.reason}`,
    });
  }

  // ----------------------------------------------------------------- exit

  async reviewPositions(open, ctx) {
    if (this._feedProblem(ctx.now)) {
      if (open.length) this.log.warn({ open: open.length }, 'Price feed not live — exits deferred');
      return [];
    }
    const price = this.market.lastPrice;
    const view = this._dataProblem(ctx.now) ? null : this._analyze(ctx.now);
    const out = [];

    for (const p of open) {
      let reason = null;
      if (p.stop_loss != null && price <= p.stop_loss)          reason = `stop loss ${p.stop_loss.toFixed(2)}`;
      else if (p.take_profit != null && price >= p.take_profit) reason = `take profit ${p.take_profit.toFixed(2)}`;
      else if (p.tag && view?.exits[p.tag])                      reason = `${p.tag} exit: ${view.exits[p.tag]}`;
      else if (ctx.now - p.opened_at >= this.trade.maxHoldMs)    reason = `time limit ${(this.trade.maxHoldMs / 3_600_000).toFixed(1)}h`;
      if (reason) out.push(closeRequest({ positionId: p.id, price, reason }));
    }
    return out;
  }

  // ------------------------------------------------------------------ mark

  // The last live swap, or the newest stored candle when the feed has not
  // ticked (still starting, down, or a separate `npm run status` process).
  // A stale mark is still the last price the feed accepted, so it is used.
  markPrice(symbol) {
    if (symbol !== this.trade.symbol) return null;
    if (this.market.lastTickAt != null && this.market.lastPrice > 0) {
      return { price: this.market.lastPrice, ts: this.market.lastTickAt };
    }
    const [last] = this.market.getCandles(this.params.entry.timeframe, 1);
    return last ? { price: last.close, ts: last.ts } : null;
  }

  // The current price only while the feed is live; otherwise null. Other
  // buckets that share this feed (the exerciser) trade and exit on this.
  livePrice(now) {
    if (this._feedProblem(now)) return null;
    return { price: this.market.lastPrice, ts: this.market.lastTickAt };
  }

  // --------------------------------------------------------------- status

  health(now) {
    const reason = this._feedProblem(now);
    return {
      ok:         !reason,
      reason,
      lastTickAt: this.market.lastTickAt ?? null,
      reconnects: this.ready ? (this.market.status().stream?.reconnects ?? 0) : null,
    };
  }

  status() {
    const v = this._view?.view;
    return {
      ready:         this.ready,
      startError:    this.startErr,
      market:        this.ready ? this.market.status() : null,
      regime:        v ? { regime: v.regime.regime, confidence: v.regime.confidence } : null,
      lastView:      v ? (v.entry ? `entry: ${v.entry.strategy}` : v.noTradeReason) : null,
      minConfidence: this.params.minConfidence,
    };
  }

  // -------------------------------------------------------------- helpers

  _feedProblem(now) {
    if (!this.ready) return `market data not running${this.startErr ? ` (${this.startErr})` : ''}`;
    if (this.market.lastTickAt == null) return 'waiting for first live swap';
    if (this.market.isStale(now)) return 'price feed stale';
    return null;
  }

  _dataProblem(now) {
    const feed = this._feedProblem(now);
    if (feed) return feed;
    const { regime, entry } = this.params;
    for (const [tf, min] of [[regime.timeframe, regime.minCandles], [entry.timeframe, entry.minCandles]]) {
      const rows = this.market.getCandles(tf, min);
      if (rows.length < min) return `warming up (${rows.length}/${min} ${tf} candles)`;
      if (!isContiguous(rows, this.tfMs[tf], now)) return `gap in ${tf} candles`;
    }
    return null;
  }

  // One analysis per cycle, shared by reviewPositions and evaluate.
  _analyze(now) {
    if (this._view?.now === now) return this._view.view;
    const view = analyze({
      regimeCandles: this.market.getCandles(this.params.regime.timeframe, this.params.regime.minCandles + 10),
      entryCandles:  this.market.getCandles(this.params.entry.timeframe, this.params.entry.minCandles + 40),
    }, this.params);
    this._view = { now, view };
    return view;
  }
}

export default LiquidDirectionalBucket;
