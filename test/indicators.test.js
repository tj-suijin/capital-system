import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adx, bollingerBands, bollingerPercentB, ema, emaSeries, macd, recentSwingLow, rsi } from '../src/analysis/indicators.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

// trading-bot's original O(n²) MACD, kept as a reference.
function oldEma(closes, period) {
  if (!closes || closes.length < period) return null;
  const k = 2 / (period + 1);
  let val = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) val = closes[i] * k + val * (1 - k);
  return val;
}
function oldMacd(closes, fast = 12, slow = 26, signal = 9) {
  const macdLine = oldEma(closes, fast) - oldEma(closes, slow);
  const series = [];
  for (let i = slow - 1; i < closes.length; i++) {
    series.push(oldEma(closes.slice(0, i + 1), fast) - oldEma(closes.slice(0, i + 1), slow));
  }
  const signalLine = oldEma(series, signal);
  return { macd: macdLine, signal: signalLine, histogram: macdLine - signalLine };
}

test('ema: seeded with the simple average, then smoothed', () => {
  // seed (1+2+3)/3 = 2, k = 0.5: 4 → 3, 5 → 4
  assert.equal(ema([1, 2, 3, 4, 5], 3), 4);
  assert.deepEqual(emaSeries([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.equal(ema([1, 2], 3), null);
});

test('rsi: uses Wilder smoothing, not a simple average of the last period', () => {
  // period 2 on [1,2,3,2,3]: seed gain 1, loss 0 → (0.5, 0.5) → (0.75, 0.25) → RS 3 → 75
  close(rsi([1, 2, 3, 2, 3], 2), 75);
  // a simple average of the last two changes (-1, +1) would give 50
  close(rsi([1, 2, 3, 2], 2), 50);
  assert.equal(rsi([1, 2, 3, 4, 5], 2), 100);
  assert.equal(rsi([3, 3, 3, 3], 2), 50);
  assert.equal(rsi([1, 2], 2), null);
});

test('macd: single-pass version matches the original implementation', () => {
  const closes = Array.from({ length: 120 }, (_, i) => 2500 + 40 * Math.sin(i / 7) + i * 0.8);
  const a = macd(closes);
  const b = oldMacd(closes);
  close(a.macd, b.macd, 1e-9);
  close(a.signal, b.signal, 1e-9);
  close(a.histogram, b.histogram, 1e-9);
  assert.equal(macd(closes.slice(0, 34)), null);
});

test('bollinger bands and %B', () => {
  const bb = bollingerBands([1, 2, 3, 4, 5], 5, 2);
  close(bb.middle, 3);
  close(bb.stdDev, Math.SQRT2);
  close(bb.upper, 3 + 2 * Math.SQRT2);
  close(bollingerPercentB(bb.middle, bb), 0.5);
  close(bollingerPercentB(bb.lower, bb), 0);
  assert.equal(bollingerPercentB(3, bollingerBands([3, 3, 3], 3)), null);
});

test('adx: a clean uptrend is maximally strong and bullish', () => {
  const n = 40;
  const highs  = Array.from({ length: n }, (_, i) => i + 1);
  const lows   = Array.from({ length: n }, (_, i) => i);
  const closes = Array.from({ length: n }, (_, i) => i + 0.5);
  const a = adx(highs, lows, closes, 14);
  close(a.adx, 100, 1e-6);
  close(a.plusDI, 100 / 1.5, 1e-6);
  assert.equal(a.minusDI, 0);
});

test('adx: smoothed, so one reversal bar does not collapse a strong trend', () => {
  const n = 40;
  const highs  = Array.from({ length: n }, (_, i) => i + 1);
  const lows   = Array.from({ length: n }, (_, i) => i);
  const closes = Array.from({ length: n }, (_, i) => i + 0.5);
  // final bar breaks sharply down
  highs.push(n - 0.5); lows.push(n - 6); closes.push(n - 5);
  const a = adx(highs, lows, closes, 14);
  assert.ok(a.adx > 85, `ADX ${a.adx} should stay high`);
  assert.ok(a.minusDI > 0);
});

test('adx: choppy market reads weak; too little data returns null', () => {
  const n = 60;
  const closes = Array.from({ length: n }, (_, i) => 100 + (i % 2 ? 1 : -1));
  const highs  = closes.map(c => c + 1.5);
  const lows   = closes.map(c => c - 1.5);
  assert.ok(adx(highs, lows, closes, 14).adx < 20);
  assert.equal(adx(highs.slice(0, 27), lows.slice(0, 27), closes.slice(0, 27), 14), null);
});

test('recentSwingLow uses lows over the lookback', () => {
  assert.equal(recentSwingLow([5, 1, 4, 3, 2], 3), 2);
  assert.equal(recentSwingLow([5], 3), null);
});
