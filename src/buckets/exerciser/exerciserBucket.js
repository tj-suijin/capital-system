// Exerciser — a test bucket, not a strategy. It opens a small long on a fixed
// wall-clock schedule (one attempt per slot, e.g. :00 and :30) and closes it
// on a tight stop, a tight target or a time limit. This keeps the open, close,
// restart and alert paths busy during a long paper run, and regularly trips
// its own position cap and daily loss limit. It is expected to lose roughly
// its trading costs.
//
// Prices come from another bucket's live feed (`feed`, bucket 1). Without a
// live price it neither enters nor exits. The feed bucket owns market data
// alerts, so this bucket always reports itself healthy.
import { Bucket } from '../bucket.js';
import { closeRequest, levelExit, noTrade, tradeIntent } from '../intent.js';

export const EXERCISER_TAG = 'exerciser';

const hhmm = ts => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export class ExerciserBucket extends Bucket {
  /**
   * @param {object} opts
   * @param {string} opts.id
   * @param {object} opts.config — config.buckets.exerciser
   * @param {Bucket} opts.feed   — a bucket with livePrice(now) and markPrice(symbol, now)
   */
  constructor({ id, config, feed, clock = Date.now }) {
    super({ id, config });
    this.feed  = feed;
    this.trade = config.trade;
    this.clock = clock;
    this._lastSlot = null;
  }

  // The current slot is treated as used, so a restart waits for the next
  // boundary instead of opening immediately (and possibly twice in one slot).
  async start() {
    this._lastSlot = this._slot(this.clock());
  }

  async evaluate(ctx) {
    const slot = this._slot(ctx.now);
    if (slot === this._lastSlot) return noTrade(`exerciser: next entry at ${hhmm((slot + 1) * this.trade.everyMs)}`);

    const live = this.feed.livePrice(ctx.now);
    if (!live) return noTrade('exerciser: no live price from the feed');

    this._lastSlot = slot;
    return tradeIntent({
      symbol:        this.trade.symbol,
      price:         live.price,
      confidence:    1,
      stopLossPct:   this.trade.stopPct,
      takeProfitPct: this.trade.targetPct,
      requestedUsd:  this.trade.sizeUsd,
      tag:           EXERCISER_TAG,
      reason:        'exerciser: scheduled test entry (not a strategy)',
    });
  }

  async reviewPositions(open, ctx) {
    const live = this.feed.livePrice(ctx.now);
    if (!live) return [];
    const price = live.price;
    const out = [];
    for (const p of open) {
      const reason = levelExit(p, price)
        ?? (ctx.now - p.opened_at >= this.trade.maxHoldMs ? `time limit ${Math.round(this.trade.maxHoldMs / 60_000)}m` : null);
      if (reason) out.push(closeRequest({ positionId: p.id, price, reason }));
    }
    return out;
  }

  markPrice(symbol, now) {
    return this.feed.markPrice(symbol, now);
  }

  subscribePrices(fn) {
    return this.feed.subscribePrices?.(fn) ?? null;
  }

  volatilityPct(now) {
    return this.feed.volatilityPct?.(now) ?? null;
  }

  status() {
    return {
      exerciser:   true,
      feed:        this.feed.id,
      nextEntryAt: this._lastSlot == null ? null : (this._lastSlot + 1) * this.trade.everyMs,
    };
  }

  _slot(now) {
    return Math.floor(now / this.trade.everyMs);
  }
}

export default ExerciserBucket;
