import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONFIG } from '../config/portfolio.js';
import { ExerciserBucket } from '../src/buckets/exerciser/exerciserBucket.js';
import { NO_TRADE, TRADE } from '../src/buckets/intent.js';
import { BucketRegistry, createDefaultRegistry } from '../src/buckets/registry.js';
import { openStore } from '../src/persistence/db.js';
import { PortfolioManager } from '../src/portfolio/portfolioManager.js';
import { fakeClock, testConfig } from './helpers.js';

const MIN = 60_000;
const SLOT = 30 * MIN;
const T0 = Date.UTC(2026, 9, 14, 12, 0, 10); // 10 s into a slot
const EX = CONFIG.buckets.exerciser;

class FakeFeed {
  constructor(price = 2500) { this.id = 'feed'; this.price = price; this.live = true; }
  livePrice(now) { return this.live ? { price: this.price, ts: now } : null; }
  markPrice(symbol, now) { return symbol === 'ETH/USDC' ? { price: this.price, ts: now } : null; }
}

async function makeBucket(clock = fakeClock(T0), feed = new FakeFeed()) {
  const bucket = new ExerciserBucket({ id: 'exerciser', config: EX, feed, clock });
  await bucket.start();
  return { bucket, feed, clock };
}

test('exerciser: config matches the agreed test rules', () => {
  assert.equal(EX.mode, 'paper');
  assert.equal(EX.paperOnly, true);
  assert.equal(EX.allocationPct, 0.02);
  assert.deepEqual(
    { ...EX.trade, ...EX.risk },
    { symbol: 'ETH/USDC', sizeUsd: 30, everyMs: SLOT, stopPct: 0.003, targetPct: 0.003, maxHoldMs: 75 * MIN,
      maxConcurrentPositions: 2, maxPositionPctOfBucket: 0.40, maxRiskPerTradePct: 0.05, dailyLossLimitPct: 0.02 },
  );
});

test('exerciser: waits for the next slot after a start, then makes one attempt per slot', async () => {
  const { bucket, clock } = await makeBucket();
  const ctx = () => ({ now: clock() });
  const first = await bucket.evaluate(ctx());
  assert.equal(first.type, NO_TRADE);
  assert.match(first.reason, /^exerciser: next entry at \d\d:\d\d$/);

  clock.advance(SLOT);
  const r = await bucket.evaluate(ctx());
  assert.equal(r.type, TRADE);
  assert.deepEqual([r.requestedUsd, r.stopLossPct, r.takeProfitPct, r.tag, r.confidence], [30, 0.003, 0.003, 'exerciser', 1]);
  assert.match(r.reason, /not a strategy/);

  clock.advance(MIN);
  assert.equal((await bucket.evaluate(ctx())).type, NO_TRADE);
});

test('exerciser: no entry and no exit without a live price; the attempt is kept for later in the slot', async () => {
  const { bucket, feed, clock } = await makeBucket();
  clock.advance(SLOT);
  feed.live = false;
  assert.equal((await bucket.evaluate({ now: clock() })).reason, 'exerciser: no live price from the feed');
  assert.deepEqual(await bucket.reviewPositions([{ id: 1, stop_loss: 1e9, take_profit: null, opened_at: 0 }], { now: clock() }), []);
  feed.live = true;
  clock.advance(MIN);
  assert.equal((await bucket.evaluate({ now: clock() })).type, TRADE);
});

test('exerciser: exits on stop, target and the 75-minute limit', async () => {
  const { bucket, feed, clock } = await makeBucket();
  const now = clock();
  const p = feed.price;
  const exits = await bucket.reviewPositions([
    { id: 1, stop_loss: p * 1.001, take_profit: null, opened_at: now },
    { id: 2, stop_loss: null, take_profit: p * 0.999, opened_at: now },
    { id: 3, stop_loss: null, take_profit: null, opened_at: now - 75 * MIN },
    { id: 4, stop_loss: null, take_profit: null, opened_at: now - 74 * MIN },
  ], { now });
  assert.deepEqual(exits.map(e => [e.positionId, e.reason]), [[1, `stop loss ${(p * 1.001).toFixed(2)}`], [2, `take profit ${(p * 0.999).toFixed(2)}`], [3, 'time limit 75m']]);
});

test('exerciser: the registry wires it to bucket 1\'s feed, and refuses a missing feed', () => {
  const registry = createDefaultRegistry(CONFIG, { store: openStore() });
  const ex = registry.get('exerciser');
  const ld = registry.get('liquidDirectional');
  assert.equal(ex.feed, ld);
  const seen = [];
  const off = ex.subscribePrices(t => seen.push(t));
  ld.market.emit('price', { price: 2500, ts: 1 });
  off();
  ld.market.emit('price', { price: 2501, ts: 2 });
  assert.deepEqual(seen, [{ symbol: 'ETH/USDC', price: 2500, ts: 1 }]);
  const broken = { ...CONFIG, buckets: { exerciser: EX } };
  assert.throws(() => createDefaultRegistry(broken, { store: openStore() }), /Exerciser feed "liquidDirectional"/);
});

test('exerciser: through the pipeline it trips its position cap, then its daily loss limit', async () => {
  const config = testConfig({ capital: { totalUsd: 4000 }, paper: CONFIG.paper });
  config.buckets = { exerciser: EX };
  const store = openStore();
  const clock = fakeClock(T0);
  const feed = new FakeFeed();
  const bucket = new ExerciserBucket({ id: 'exerciser', config: EX, feed, clock });
  const pm = new PortfolioManager({ config, store, registry: new BucketRegistry().register(bucket), clock });
  pm.init();
  await bucket.start();
  const cycle = async () => { clock.advance(SLOT); await pm.runBucketCycle('exerciser'); };
  const last = () => store.getRecentDecisions(1, 'exerciser')[0];

  assert.equal(store.getLedger('exerciser').allocated_usd, 80);
  await cycle();
  assert.equal(last().outcome, 'APPROVED');
  const first = store.getOpenPositions('exerciser')[0];
  assert.equal(first.notional_usd, 30);
  // Stop and target sit 0.3% from the market price; the fill includes slippage.
  assert.ok(Math.abs(first.entry_price - feed.price * (1 + CONFIG.paper.slippagePct)) < 1e-9);
  assert.ok(Math.abs(first.stop_loss - feed.price * 0.997) < 1e-9);
  assert.ok(Math.abs(first.take_profit - feed.price * 1.003) < 1e-9);
  await cycle();
  await cycle(); // both still open (60 and 30 minutes old)
  assert.equal(last().outcome, 'REJECTED');
  assert.equal(last().code, 'BR_002');

  // Each slot the price falls 0.5%: the previous position stops out, a new one opens.
  let tripped = null;
  for (let i = 0; i < 20 && !tripped; i++) {
    feed.price *= 0.995;
    await cycle();
    if (last().code === 'BR_004') tripped = last();
  }
  assert.ok(tripped, 'daily loss limit was reached');
  const loss = -store.realizedPnlSince(clock() - 24 * 60 * MIN, 'exerciser');
  assert.ok(loss >= 80 * EX.risk.dailyLossLimitPct, `loss ${loss}`);
  assert.equal(pm.globalRisk.isHalted(), false);
  assert.equal(store.getRecentDecisions(100, 'exerciser').filter(d => d.outcome === 'ERROR').length, 0);
});
