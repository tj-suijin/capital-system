import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONFIG } from '../config/portfolio.js';
import { NO_TRADE, TRADE } from '../src/buckets/intent.js';
import { LiquidDirectionalBucket } from '../src/buckets/liquidDirectional/liquidDirectionalBucket.js';
import { BucketRegistry } from '../src/buckets/registry.js';
import { openStore } from '../src/persistence/db.js';
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
function dip() {
  const c = path(100, i => 2500 * (1 + 0.002 * Math.sin(i / 3)));
  for (let k = 0; k < 4; k++) c.push(c.at(-1) * 0.996);
  return c;
}
function crossBelow() {
  const c = path(100, i => 2500 * 1.001 ** i);
  c.push(c.at(-1) * 0.97);
  return c;
}

class FakeMarket {
  constructor({ entry = dip(), regime = RANGE } = {}) {
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
