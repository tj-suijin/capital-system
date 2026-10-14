// Technical indicators. Pure functions over arrays of numbers, oldest first.
// Each returns null when there is not enough data.

// EMA series seeded with the simple average of the first `period` values.
// Entries before index period-1 are null.
export function emaSeries(values, period) {
  const out = new Array(values?.length ?? 0).fill(null);
  if (!values || values.length < period) return out;
  const k = 2 / (period + 1);
  let v = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = v;
  for (let i = period; i < values.length; i++) {
    v = values[i] * k + v * (1 - k);
    out[i] = v;
  }
  return out;
}

export function ema(values, period) {
  if (!values || values.length < period) return null;
  return emaSeries(values, period).at(-1);
}

// RSI with Wilder's smoothing.
export function rsi(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

export function macd(closes, fast = 12, slow = 26, signal = 9) {
  if (!closes || closes.length < slow + signal) return null;
  const f = emaSeries(closes, fast);
  const s = emaSeries(closes, slow);
  const line = [];
  for (let i = slow - 1; i < closes.length; i++) line.push(f[i] - s[i]);
  const macdLine = line.at(-1);
  const signalLine = ema(line, signal);
  return {
    macd:      macdLine,
    signal:    signalLine,
    histogram: signalLine == null ? null : macdLine - signalLine,
  };
}

// Population standard deviation over the last `period` closes.
export function bollingerBands(closes, period = 20, stdDevMult = 2) {
  if (!closes || closes.length < period) return null;
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const stdDev = Math.sqrt(slice.reduce((s, v) => s + (v - middle) ** 2, 0) / period);
  return {
    upper: middle + stdDevMult * stdDev,
    middle,
    lower: middle - stdDevMult * stdDev,
    width: (2 * stdDevMult * stdDev) / middle,
    stdDev,
  };
}

// 0 at the lower band, 1 at the upper band.
export function bollingerPercentB(price, bb) {
  if (!bb || bb.upper === bb.lower) return null;
  return (price - bb.lower) / (bb.upper - bb.lower);
}

// Wilder's ADX: smoothed TR and ±DM give ±DI and DX per bar; ADX is the
// Wilder average of DX. Needs at least 2 × period candles.
export function adx(highs, lows, closes, period = 14) {
  const n = highs?.length ?? 0;
  if (n < 2 * period || lows.length !== n || closes.length !== n) return null;

  const tr = [], pdm = [], mdm = [];
  for (let i = 1; i < n; i++) {
    const up   = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    pdm.push(up > down && up > 0 ? up : 0);
    mdm.push(down > up && down > 0 ? down : 0);
  }

  let sTr = 0, sP = 0, sM = 0;
  for (let i = 0; i < period; i++) { sTr += tr[i]; sP += pdm[i]; sM += mdm[i]; }

  const di = () => {
    const plusDI  = sTr ? (sP / sTr) * 100 : 0;
    const minusDI = sTr ? (sM / sTr) * 100 : 0;
    const sum = plusDI + minusDI;
    return { plusDI, minusDI, dx: sum ? (Math.abs(plusDI - minusDI) / sum) * 100 : 0 };
  };

  const dxs = [di()];
  for (let i = period; i < tr.length; i++) {
    sTr = sTr - sTr / period + tr[i];
    sP  = sP  - sP  / period + pdm[i];
    sM  = sM  - sM  / period + mdm[i];
    dxs.push(di());
  }

  let value = dxs.slice(0, period).reduce((a, d) => a + d.dx, 0) / period;
  for (let i = period; i < dxs.length; i++) value = (value * (period - 1) + dxs[i].dx) / period;
  const last = dxs.at(-1);
  return { adx: value, plusDI: last.plusDI, minusDI: last.minusDI };
}

// Lowest low of the last `lookback` candles.
export function recentSwingLow(lows, lookback = 10) {
  if (!lows || lows.length < lookback) return null;
  return Math.min(...lows.slice(-lookback));
}
