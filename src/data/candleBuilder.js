// CandleBuilder — aggregates swap prices into OHLC candles for several
// timeframes and writes them to the store.
//
// Outlier filter: a price more than outlierPct away from the median of the
// recent raw prices is dropped. Every price (accepted or not) joins the
// window, so a one-off spike is outvoted while a real level shift moves the
// median and is accepted after a few swaps.
//
// Gaps: when a tick lands more than one interval after the open candle,
// up to maxGapFillCandles flat candles (swaps = 0) are written at the last
// close. Longer gaps are left empty so callers can detect missing data.

const WINDOW = 21;
const MIN_WINDOW = 5;

export class CandleBuilder {
  /**
   * @param {object} opts
   * @param {Store}  opts.store
   * @param {object} opts.pool               — pool definition (id, minPrice, maxPrice)
   * @param {object} opts.timeframes         — { '1m': 60000, ... }
   * @param {number} opts.outlierPct
   * @param {number} opts.maxGapFillCandles
   * @param {Function} [opts.onClose]        — (timeframe, candle) when a candle completes
   */
  constructor({ store, pool, timeframes, outlierPct, maxGapFillCandles, onClose = () => {} }) {
    this.store      = store;
    this.pool       = pool;
    this.timeframes = timeframes;
    this.outlierPct = outlierPct;
    this.maxGap     = maxGapFillCandles;
    this.onClose    = onClose;
    this.open       = {};   // timeframe → in-progress candle
    this.window     = [];
    this.rejected   = 0;
  }

  // Resume from stored candles. With beforeTs, only candles strictly earlier
  // are used (a backfill rebuilds everything from beforeTs on).
  resume(beforeTs) {
    for (const tf of Object.keys(this.timeframes)) {
      const row = this.store.getLastCandle(this.pool.id, tf, beforeTs);
      this.open[tf] = row && {
        ts: row.ts, open: row.open, high: row.high, low: row.low, close: row.close,
        volumeQuote: row.volume_quote, swaps: row.swaps,
      };
    }
  }

  // Returns true if the price was accepted.
  tick(price, tsMs, volumeQuote = 0) {
    if (!(price >= this.pool.minPrice && price <= this.pool.maxPrice)) {
      this.rejected++;
      return false;
    }
    this.window.push(price);
    if (this.window.length > WINDOW) this.window.shift();
    if (this.window.length >= MIN_WINDOW) {
      const med = median(this.window);
      if (Math.abs(price - med) / med > this.outlierPct) {
        this.rejected++;
        return false;
      }
    }

    for (const [tf, ms] of Object.entries(this.timeframes)) {
      const bucketTs = Math.floor(tsMs / ms) * ms;
      const cur = this.open[tf];

      if (cur && bucketTs < cur.ts) continue; // late tick for an already-closed interval
      if (cur && bucketTs === cur.ts) {
        cur.high = Math.max(cur.high, price);
        cur.low  = Math.min(cur.low, price);
        cur.close = price;
        cur.volumeQuote += volumeQuote;
        cur.swaps++;
        continue;
      }

      if (cur) {
        this._write(tf, cur);
        this.onClose(tf, { ...cur });
        const missing = (bucketTs - cur.ts) / ms - 1;
        if (missing > 0 && missing <= this.maxGap) {
          for (let t = cur.ts + ms; t < bucketTs; t += ms) {
            const flat = { ts: t, open: cur.close, high: cur.close, low: cur.close, close: cur.close, volumeQuote: 0, swaps: 0 };
            this._write(tf, flat);
            this.onClose(tf, flat);
          }
        }
      }
      this.open[tf] = { ts: bucketTs, open: price, high: price, low: price, close: price, volumeQuote, swaps: 1 };
    }
    return true;
  }

  // Write in-progress candles so readers see the latest values.
  flush() {
    for (const [tf, c] of Object.entries(this.open)) if (c) this._write(tf, c);
  }

  _write(tf, c) {
    this.store.upsertCandle({ pool: this.pool.id, timeframe: tf, ...c });
  }
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// True if candles are consecutive intervals with no holes, and the last one
// is the current or previous interval at `now`.
export function isContiguous(candles, intervalMs, now) {
  if (!candles.length) return false;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].ts - candles[i - 1].ts !== intervalMs) return false;
  }
  const current = Math.floor(now / intervalMs) * intervalMs;
  return current - candles[candles.length - 1].ts <= intervalMs;
}
