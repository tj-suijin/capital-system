import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONFIG } from '../config/portfolio.js';
import { STRATEGY, analyze } from '../src/buckets/liquidDirectional/analyst.js';
import { meanReversion } from '../src/buckets/liquidDirectional/meanReversion.js';
import { REGIME, detectRegime } from '../src/buckets/liquidDirectional/regimeDetector.js';
import { trendFollowing } from '../src/buckets/liquidDirectional/trendFollowing.js';

const P = CONFIG.buckets.majorsTrader.strategy;

function candles(closes) {
  return closes.map((c, i) => {
    const prev = closes[i - 1] ?? c;
    return { ts: i * 60_000, open: prev, high: Math.max(c, prev) * 1.0005, low: Math.min(c, prev) * 0.9995, close: c };
  });
}
const series = cs => ({ closes: cs.map(c => c.close), highs: cs.map(c => c.high), lows: cs.map(c => c.low) });
const path = (n, f) => Array.from({ length: n }, (_, i) => f(i));

const UP    = candles(path(220, i => 2500 * 1.001 ** i));
const DOWN  = candles(path(220, i => 2500 * 0.999 ** i));
const RANGE = candles(path(220, i => 2500 * (1 + 0.004 * Math.sin(i / 3))));

// Ranging, then four sharp down candles.
function dip() {
  const c = path(100, i => 2500 * (1 + 0.002 * Math.sin(i / 3)));
  for (let k = 0; k < 4; k++) c.push(c.at(-1) * 0.996);
  return candles(c);
}

// Steady uptrend, then a shallow pullback toward the fast EMA.
function pullback() {
  const c = path(100, i => 2500 * 1.0005 ** i);
  for (let k = 0; k < 6; k++) c.push(c.at(-1) * 0.9995);
  return candles(c);
}

test('regime: uptrend, downtrend and range are classified', () => {
  assert.equal(detectRegime(series(UP), P.regime).regime, REGIME.TRENDING_UP);
  assert.equal(detectRegime(series(DOWN), P.regime).regime, REGIME.TRENDING_DOWN);
  assert.equal(detectRegime(series(RANGE), P.regime).regime, REGIME.RANGING);
});

test('regime: uncertain while warming up', () => {
  const r = detectRegime(series(UP.slice(0, 150)), P.regime);
  assert.equal(r.regime, REGIME.UNCERTAIN);
  assert.equal(r.confidence, 0);
  assert.match(r.reason, /warming up \(150\/200/);
});

test('trend following: crossing below the fast EMA is an exit', () => {
  const c = path(80, i => 2500 * 1.001 ** i);
  c.push(c.at(-1) * 0.97);
  assert.equal(trendFollowing(series(candles(c)), P.trendFollowing).direction, 'SELL');
});

test('trend following: stop is the swing low of candle lows, not closes', () => {
  const cs = pullback();
  const sig = trendFollowing(series(cs), P.trendFollowing);
  assert.equal(sig.direction, 'BUY');
  assert.equal(sig.stopLoss, Math.min(...cs.slice(-10).map(c => c.low)));
});

test('mean reversion: buys a dip below the lower band, targets the middle', () => {
  const sig = meanReversion(series(dip()), P.meanReversion);
  assert.equal(sig.direction, 'BUY');
  assert.ok(sig.targetPrice > sig.stopLoss);
  assert.match(sig.reason, /below lower BB/);
});

test('analyst: ranging regime + dip → mean-reversion entry', () => {
  const v = analyze({ regimeCandles: RANGE, entryCandles: dip() }, P);
  assert.equal(v.noTradeReason, null);
  assert.equal(v.entry.strategy, STRATEGY.MEAN_REVERSION);
  assert.ok(Math.abs(v.entry.confidence - v.signals.mean_reversion.confidence * v.regime.confidence) < 1e-12);
});

test('analyst: combined confidence must clear minConfidence', () => {
  const view = minConfidence => analyze({ regimeCandles: UP, entryCandles: pullback() }, { ...P, minConfidence });
  const strict = view(0.99);
  assert.equal(strict.entry, null);
  assert.match(strict.noTradeReason, /confidence \d+% below 99%/);
  assert.equal(view(0.10).entry.strategy, STRATEGY.TREND);
});

test('analyst: downtrend and warm-up are no-trade', () => {
  assert.match(analyze({ regimeCandles: DOWN, entryCandles: dip() }, P).noTradeReason, /downtrend/);
  assert.match(analyze({ regimeCandles: RANGE, entryCandles: dip().slice(0, 30) }, P).noTradeReason, /warming up \(30\/60\)/);
});

test('analyst: exit signals are reported whatever the regime', () => {
  const c = path(80, i => 2500 * 1.001 ** i);
  c.push(c.at(-1) * 0.97);
  const v = analyze({ regimeCandles: DOWN, entryCandles: candles(c) }, P);
  assert.ok(v.exits[STRATEGY.TREND]);
  assert.equal(v.entry, null);
});
