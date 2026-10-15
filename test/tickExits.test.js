import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tradeIntent } from '../src/buckets/intent.js';
import { PaperExecutor } from '../src/execution/paperExecutor.js';
import { makePortfolio, testConfig } from './helpers.js';

const SYMBOL = 'WETH/USDC';
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

async function withPosition(config = testConfig()) {
  const { pm, store, registry, clock } = makePortfolio({ config });
  pm.init();
  const alpha = registry.get('alpha');
  alpha.entries.push(tradeIntent({ symbol: SYMBOL, price: 2000, stopLossPct: 0.01, takeProfitPct: 0.02, reason: 'test setup' }));
  await pm.runBucketCycle('alpha');
  const [position] = store.getOpenPositions('alpha');
  return { pm, store, alpha, clock, position };
}

test('tick exits: a fresh tick past the stop closes the position at that price', async () => {
  const { pm, store, clock, position } = await withPosition();
  await pm.onPriceTick('alpha', { symbol: SYMBOL, price: 1985, ts: clock() - 11_000 }); // replayed, too old
  await pm.onPriceTick('alpha', { symbol: 'OTHER/USDC', price: 1, ts: clock() });
  await pm.onPriceTick('alpha', { symbol: SYMBOL, price: 1990, ts: clock() });           // above the 1980 stop
  assert.equal(store.getPosition(position.id).status, 'open');

  await pm.onPriceTick('alpha', { symbol: SYMBOL, price: 1975, ts: clock() });
  const closed = store.getPosition(position.id);
  assert.equal(closed.status, 'closed');
  assert.equal(closed.exit_reason, 'stop loss 1980.00');
  close(closed.exit_price, 1975);
});

test('tick exits: a tick at the target closes the position', async () => {
  const { pm, store, clock, position } = await withPosition();
  await pm.onPriceTick('alpha', { symbol: SYMBOL, price: 2041, ts: clock() });
  assert.equal(store.getPosition(position.id).exit_reason, 'take profit 2040.00');
});

test('tick exits: a tick and a cycle closing the same position at once release capital only once', async () => {
  const { pm, store, alpha, clock, position } = await withPosition();
  alpha.exits.push({ positionId: position.id, price: 1970, reason: 'stop loss 1980.00' });
  await Promise.all([
    pm.onPriceTick('alpha', { symbol: SYMBOL, price: 1975, ts: clock() }),
    pm.runBucketCycle('alpha'),
  ]);
  const l = store.getLedger('alpha');
  assert.equal(store.getRecentTrades(10, 'alpha').filter(t => t.action === 'CLOSE').length, 1);
  close(l.in_use_usd, 0);
  close(l.cash_usd, l.allocated_usd + l.realized_pnl_usd);
});

test('tick exits: start() subscribes each bucket to its prices and stop() unsubscribes', async () => {
  const { pm, store, alpha, clock, position } = await withPosition();
  await pm.start();
  try {
    assert.equal(typeof alpha.tickFn, 'function');
    await alpha.tickFn({ symbol: SYMBOL, price: 1975, ts: clock() });
    assert.equal(store.getPosition(position.id).status, 'closed');
  } finally {
    await pm.stop();
  }
  assert.equal(alpha.tickFn, null);
});

test('paper slippage grows with the bucket\'s recent range', async () => {
  const ex = new PaperExecutor({ feePct: 0, slippagePct: 0.001, rangeSlippageShare: 0.25 });
  close((await ex.open({ price: 2000, notionalUsd: 100 })).fillPrice, 2000 * 1.001);
  close((await ex.open({ price: 2000, notionalUsd: 100, volatilityPct: 0.008 })).fillPrice, 2000 * 1.003);
  close((await ex.close({ position: { qty: 1 }, price: 2000, volatilityPct: 0.008 })).fillPrice, 2000 * 0.997);

  const config = testConfig({ paper: { feePct: 0, slippagePct: 0.001, rangeSlippageShare: 0.25 } });
  const { pm, store, registry } = makePortfolio({ config });
  pm.init();
  const alpha = registry.get('alpha');
  alpha.vol = 0.008;
  alpha.entries.push(tradeIntent({ symbol: SYMBOL, price: 2000, reason: 'test setup' }));
  await pm.runBucketCycle('alpha');
  const [p] = store.getOpenPositions('alpha');
  close(p.entry_price, 2000 * 1.003);
  alpha.vol = null;
  close((await pm.closePosition(p.id, 2000, 'flat')).exit_price, 2000 * 0.999);
});
