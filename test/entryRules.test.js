import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tradeIntent } from '../src/buckets/intent.js';
import { makePortfolio, testConfig } from './helpers.js';

const MIN = 60_000;
const intent = () => tradeIntent({ symbol: 'WETH/USDC', price: 2000, reason: 'test setup' });

function setup(risk) {
  const { pm, store, registry, clock } = makePortfolio({ config: testConfig({ buckets: { alpha: { risk } } }) });
  pm.init();
  const alpha = registry.get('alpha');
  alpha.marks['WETH/USDC'] = 2000;
  const enter = async () => {
    alpha.entries.push(intent());
    await pm.runBucketCycle('alpha');
    return store.getRecentDecisions(1, 'alpha')[0];
  };
  return { pm, store, alpha, clock, enter };
}

test('entry rules: off unless configured', async () => {
  const { enter } = setup({});
  assert.equal((await enter()).outcome, 'APPROVED');
  assert.equal((await enter()).outcome, 'APPROVED');
});

test('entry rules: no entry within the cooldown after a stop-out; other exits do not start it', async () => {
  const { pm, store, clock, enter } = setup({ cooldownAfterStopMs: 15 * MIN });
  await enter();
  let [p] = store.getOpenPositions('alpha');
  await pm.closePosition(p.id, 2000, 'take profit 2010.00');
  assert.equal((await enter()).outcome, 'APPROVED');

  [p] = store.getOpenPositions('alpha');
  await pm.closePosition(p.id, 1990, 'stop loss 1990.00');
  clock.advance(14 * MIN);
  const d = await enter();
  assert.equal(d.code, 'BR_005');
  assert.match(d.reason, /stopped out 14m ago, entries resume in 1m/);

  clock.advance(MIN);
  assert.equal((await enter()).outcome, 'APPROVED');
});

test('entry rules: minimum spacing between entries on the same side', async () => {
  const { clock, enter } = setup({ minEntrySpacingMs: 10 * MIN });
  assert.equal((await enter()).outcome, 'APPROVED');
  clock.advance(9 * MIN);
  const d = await enter();
  assert.equal(d.code, 'BR_006');
  assert.match(d.reason, /last BUY 9m ago, minimum 10m/);
  clock.advance(MIN);
  assert.equal((await enter()).outcome, 'APPROVED');
});

test('entry rules: no entry while an open position is under water at its mark', async () => {
  const { store, alpha, enter } = setup({ noEntryWhileLosing: true });
  await enter();
  const [p] = store.getOpenPositions('alpha');

  alpha.marks['WETH/USDC'] = 1990;
  const d = await enter();
  assert.equal(d.code, 'BR_007');
  assert.match(d.reason, new RegExp(`#${p.id} at -\\$0\\.30`));

  alpha.marks['WETH/USDC'] = null; // no price: the position is valued at cost and does not block
  assert.equal((await enter()).outcome, 'APPROVED');
});
