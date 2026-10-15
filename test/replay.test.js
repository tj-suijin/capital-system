// Fast replay: about three days of synthetic 1-minute candles through the full
// pipeline (bucket 1 at its paper settings plus the exerciser, real paper
// costs, $4,000), checking after every minute that the ledgers still add up.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONFIG } from '../config/portfolio.js';
import { ExerciserBucket } from '../src/buckets/exerciser/exerciserBucket.js';
import { LiquidDirectionalBucket } from '../src/buckets/liquidDirectional/liquidDirectionalBucket.js';
import { BucketRegistry } from '../src/buckets/registry.js';
import { openStore } from '../src/persistence/db.js';
import { PortfolioManager } from '../src/portfolio/portfolioManager.js';
import { RESERVE_ID } from '../config/portfolio.js';
import { testConfig } from './helpers.js';

const MIN = 60_000;
const WARMUP = 1_100;          // minutes of history before the first cycle (regime needs ~1,050)
const MINUTES = 3 * 24 * 60;   // replayed minutes
const START = Date.UTC(2026, 9, 10);
const EPS = 1e-6;

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Six-hour segments cycling through ranging, rising, ranging and falling markets.
function synthCandles(n, seed = 7) {
  const rnd = mulberry32(seed);
  const noise = s => (rnd() - 0.5) * 2 * s;
  const out = [];
  let price = 2500, anchor = price;
  for (let i = 0; i < n; i++) {
    const kind = ['range', 'up', 'range', 'down'][Math.floor(i / 360) % 4];
    const open = price;
    if (kind === 'range') {
      if (i % 360 === 0) anchor = price;
      price = anchor * (1 + 0.004 * Math.sin(i / 9)) * (1 + noise(0.0006));
    } else {
      price *= 1 + (kind === 'up' ? 0.00012 : -0.00012) + noise(0.0006);
    }
    const close = price;
    out.push({ ts: START + i * MIN, open, high: Math.max(open, close) * (1 + Math.abs(noise(0.0003))), low: Math.min(open, close) * (1 - Math.abs(noise(0.0003))), close });
  }
  return out;
}

function aggregate(m1, size) {
  const out = [];
  for (let i = 0; i + size <= m1.length; i += size) {
    const g = m1.slice(i, i + size);
    out.push({ ts: g[0].ts, open: g[0].open, high: Math.max(...g.map(c => c.high)), low: Math.min(...g.map(c => c.low)), close: g.at(-1).close });
  }
  return out;
}

class ReplayMarket {
  constructor(m1) {
    this.m1 = m1;
    this.m5 = aggregate(m1, 5);
    this.i = 0; this.j = 0;
    this.lastPrice = null; this.lastTickAt = null;
  }
  async start() {}
  async stop() {}
  advanceTo(now) {
    while (this.i + 1 < this.m1.length && this.m1[this.i + 1].ts <= now) this.i++;
    while (this.j + 1 < this.m5.length && this.m5[this.j + 1].ts <= now) this.j++;
    this.lastPrice = this.m1[this.i].close;
    this.lastTickAt = now;
  }
  isStale() { return false; }
  getCandles(tf, limit) {
    const [arr, end] = tf === '1m' ? [this.m1, this.i + 1] : [this.m5, this.j + 1];
    return arr.slice(Math.max(0, end - limit), end);
  }
  status() { return { replay: true }; }
}

function checkLedgers(store, config, minute) {
  const ledgers = store.getAllLedgers();
  assert.ok(Math.abs(ledgers.reduce((n, l) => n + l.allocated_usd, 0) - config.capital.totalUsd) < EPS);
  for (const l of ledgers) {
    const where = `${l.bucket_id} at minute ${minute}`;
    if (l.bucket_id === RESERVE_ID) {
      assert.equal(l.in_use_usd, 0, where);
      assert.ok(Math.abs(l.cash_usd - l.allocated_usd) < EPS, where);
      continue;
    }
    const open = store.getOpenPositions(l.bucket_id);
    assert.ok(open.length <= config.buckets[l.bucket_id].risk.maxConcurrentPositions, `${where}: too many open`);
    assert.ok(l.cash_usd >= -EPS, `${where}: negative cash`);
    assert.ok(Math.abs(l.in_use_usd - open.reduce((n, p) => n + p.notional_usd, 0)) < EPS, `${where}: in-use ≠ open notional`);
    assert.ok(Math.abs(l.cash_usd + l.in_use_usd - l.allocated_usd - l.realized_pnl_usd) < EPS, `${where}: cash + in-use ≠ allocated + realized`);
    const realized = store.realizedPnlSince(0, l.bucket_id);
    assert.ok(Math.abs(realized - l.realized_pnl_usd) < EPS, `${where}: realized ≠ sum of closed P&L`);
  }
}

test('replay: three days through the full pipeline keep every ledger consistent', async () => {
  const config = testConfig({ capital: { totalUsd: 4000 }, paper: CONFIG.paper, alerts: CONFIG.alerts });
  // System Test is off in config; the replay turns it on to keep the pipeline busy.
  config.buckets = {
    majorsTrader: CONFIG.buckets.majorsTrader,
    systemTest:   { ...CONFIG.buckets.systemTest, enabled: true },
  };
  const store  = openStore();
  const market = new ReplayMarket(synthCandles(WARMUP + MINUTES));
  let now = START + WARMUP * MIN + 30_000;
  const clock = () => now;

  const ld = new LiquidDirectionalBucket({ id: 'majorsTrader', config: config.buckets.majorsTrader, market });
  const ex = new ExerciserBucket({ id: 'systemTest', config: config.buckets.systemTest, feed: ld, clock });
  const pm = new PortfolioManager({ config, store, registry: new BucketRegistry().register(ld).register(ex), clock });
  pm.init();
  market.advanceTo(now);
  await ld.start();
  await ex.start();

  for (let k = 0; k < MINUTES - 1; k++) {
    market.advanceTo(now);
    await pm.runBucketCycle('majorsTrader');
    await pm.runBucketCycle('systemTest');
    if (k % 5 === 0) pm.heartbeat();
    checkLedgers(store, config, k);
    now += MIN;
  }

  const all = store.getRecentDecisions(1e6);
  const by = (bucket, outcome, code) => all.filter(d => d.bucket_id === bucket && d.outcome === outcome && (!code || d.code === code)).length;
  assert.equal(all.filter(d => d.outcome === 'ERROR').length, 0, 'no cycle errors');
  assert.equal(all.filter(d => d.bucket_id === 'majorsTrader').length, MINUTES - 1, 'bucket 1 decided every minute');
  assert.equal(pm.globalRisk.isHalted(), false);

  // The position cap is covered in exerciser.test.js; with these swings the
  // exerciser's tight stops close positions before a second one opens.
  const exTrades = store.positionsOpenedBetween(0, Infinity).filter(p => p.bucket_id === 'systemTest');
  assert.ok(exTrades.length > 20, `exerciser opened ${exTrades.length}`);  assert.ok(by('systemTest', 'REJECTED', 'BR_004') > 0, 'daily loss limit was hit');
  const exLoss24h = -store.realizedPnlSince(now - 24 * 60 * MIN, 'systemTest');
  assert.ok(exLoss24h < 80 * 0.02 + 0.5, `the daily limit bounds the loss (24h loss ${exLoss24h.toFixed(2)})`);
  for (const p of store.positionsClosedBetween(0, Infinity)) {
    assert.match(p.exit_reason, /^(stop loss|take profit|time limit|mean_reversion exit|trend_following exit)/);
    if (p.bucket_id === 'systemTest') assert.ok(p.closed_at - p.opened_at <= 75 * MIN + MIN, 'exerciser never holds past its limit');
    else assert.ok(p.closed_at - p.opened_at <= 4 * 60 * MIN + MIN, 'bucket 1 never holds past its limit');
  }
  assert.ok(store.equitySnapshotsBetween('portfolio', 0, Infinity).length > 800);
});
