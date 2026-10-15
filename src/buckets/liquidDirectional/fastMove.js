// Fast-move filter for bucket 1's entries. Pure functions over candles.
//
// A candle is fast when its high-low range is at least
//   max(minRangePct, avgMultiple × the average range of the `lookback`
//   candles before the window).
// Entries are blocked while any candle in the window is fast. The window is
// the newest `calmCandles + 1` candles; the newest may still be forming, so a
// crash is seen while it happens, and the block lasts until `calmCandles`
// calm candles have completed.

export function rangePct(candle) {
  return candle.open > 0 ? (candle.high - candle.low) / candle.open : 0;
}

// Returns the newest fast candle in the window as
// { ts, rangePct, limitPct, avgPct }, or null.
export function findFastMove(candles, { minRangePct, avgMultiple, lookback, calmCandles }) {
  const win = Math.min(calmCandles + 1, candles.length);
  const base = candles.slice(Math.max(0, candles.length - win - lookback), candles.length - win);
  const avgPct = base.length ? base.reduce((n, c) => n + rangePct(c), 0) / base.length : 0;
  const limitPct = Math.max(minRangePct, avgMultiple * avgPct);
  for (let i = candles.length - 1; i >= candles.length - win; i--) {
    const r = rangePct(candles[i]);
    if (r >= limitPct) return { ts: candles[i].ts, rangePct: r, limitPct, avgPct };
  }
  return null;
}
