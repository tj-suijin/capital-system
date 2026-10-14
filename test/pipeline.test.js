import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeRequest, tradeIntent } from '../src/buckets/intent.js';
import { ControlApi } from '../src/control/controlApi.js';
import { LiveExecutorStub } from '../src/execution/liveExecutor.js';
import { TelegramControl } from '../src/alerts/telegram.js';
import { makePortfolio, testConfig } from './helpers.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const intent = (extra = {}) => tradeIntent({ symbol: 'WETH/USDC', price: 2000, reason: 'test setup', ...extra });

test('no-trade is recorded as a normal decision', async () => {
  const { pm, store } = makePortfolio();
  pm.init();
  await pm.runBucketCycle('alpha');
  const [d] = store.getRecentDecisions(1, 'alpha');
  assert.equal(d.outcome, 'NO_TRADE');
  assert.equal(store.getOpenPositions().length, 0);
});

test('approved intent opens a paper position, close releases capital with P&L', async () => {
  const { pm, store, registry } = makePortfolio();
  pm.init();
  const fills = [];
  pm.events.on('fill', e => fills.push(e));

  registry.get('alpha').entries.push(intent());
  await pm.runBucketCycle('alpha');

  const [pos] = store.getOpenPositions('alpha');
  assert.ok(pos, 'position opened');
  close(pos.notional_usd, 60);              // 10% of $600
  close(pm.allocator.available('alpha'), 540);
  assert.equal(fills.length, 1);
  assert.equal(store.getRecentDecisions(1, 'alpha')[0].outcome, 'APPROVED');

  registry.get('alpha').exits.push(closeRequest({ positionId: pos.id, price: 2200, reason: 'take profit' }));
  await pm.runBucketCycle('alpha');

  const closed = store.getPosition(pos.id);
  assert.equal(closed.status, 'closed');
  close(closed.pnl_usd, 6);                 // +10% on $60, zero fees in test config
  close(pm.allocator.available('alpha'), 606);
  close(pm.allocator.ledger('alpha').realized_pnl_usd, 6);
});

test('paper fees and slippage reduce P&L', async () => {
  const config = testConfig({ paper: { feePct: 0.001, slippagePct: 0.001 } });
  const { pm, store, registry } = makePortfolio({ config });
  pm.init();
  registry.get('alpha').entries.push(intent());
  await pm.runBucketCycle('alpha');
  const [pos] = store.getOpenPositions('alpha');
  const closed = await pm.closePosition(pos.id, 2000, 'flat');
  assert.ok(closed.pnl_usd < 0, 'a flat round trip loses fees + slippage');
});

test('halt and wind-down reject entries but exits still work', async () => {
  const { pm, store, registry } = makePortfolio();
  pm.init();
  registry.get('alpha').entries.push(intent());
  await pm.runBucketCycle('alpha');
  const [pos] = store.getOpenPositions('alpha');

  pm.halt('test');
  registry.get('alpha').entries.push(intent());
  await pm.runBucketCycle('alpha');
  assert.equal(store.getRecentDecisions(1, 'alpha')[0].code, 'PM_001');

  registry.get('alpha').exits.push(closeRequest({ positionId: pos.id, price: 1900, reason: 'stop' }));
  await pm.runBucketCycle('alpha');
  assert.equal(store.getPosition(pos.id).status, 'closed');

  pm.unhalt();
  pm.setWindDown(true);
  registry.get('alpha').entries.push(intent());
  await pm.runBucketCycle('alpha');
  assert.equal(store.getRecentDecisions(1, 'alpha')[0].code, 'PM_002');
});

test('paused bucket is isolated from other buckets', async () => {
  const { pm, store, registry } = makePortfolio();
  pm.init();
  pm.pauseBucket('alpha', 'debugging');
  registry.get('alpha').entries.push(intent());
  registry.get('beta').entries.push(intent({ symbol: 'BONK/SOL', price: 0.00002 }));
  await pm.runBucketCycle('alpha');
  await pm.runBucketCycle('beta');
  assert.equal(store.getRecentDecisions(1, 'alpha')[0].code, 'BR_001');
  assert.equal(store.getOpenPositions('beta').length, 1);
});

test('shadow mode runs every check but opens nothing', async () => {
  const config = testConfig({ buckets: { alpha: { mode: 'shadow' } } });
  const { pm, store, registry } = makePortfolio({ config });
  pm.init();
  registry.get('alpha').entries.push(intent());
  await pm.runBucketCycle('alpha');
  assert.equal(store.getRecentDecisions(1, 'alpha')[0].outcome, 'SHADOW');
  assert.equal(store.getOpenPositions().length, 0);
  close(pm.allocator.available('alpha'), 600);
});

test('live gate: refuses to start unless every condition holds', () => {
  const live = testConfig({ buckets: { alpha: { mode: 'live' } } });
  assert.throws(() => makePortfolio({ config: live }).pm.init(), /TRADING_MODE is not "live"/);

  const allButAdapter = testConfig({ mode: 'live', buckets: { alpha: { mode: 'live', live: true } } });
  assert.throws(() => makePortfolio({ config: allButAdapter }).pm.init(), /no live execution adapter/);

  const paperOnly = testConfig({ mode: 'live', buckets: { beta: { mode: 'live', live: true } } });
  assert.throws(() => makePortfolio({ config: paperOnly, liveAdapters: { beta: new LiveExecutorStub() } }).pm.init(), /paperOnly/);
});

test('executor failure releases reserved capital', async () => {
  const config = testConfig({ mode: 'live', buckets: { alpha: { mode: 'live', live: true } } });
  const { pm, store, registry } = makePortfolio({ config, liveAdapters: { alpha: new LiveExecutorStub('uniswap-base') } });
  pm.init();
  registry.get('alpha').entries.push(intent());
  await pm.runBucketCycle('alpha');
  const [d] = store.getRecentDecisions(1, 'alpha');
  assert.equal(d.stage, 'executor');
  assert.equal(d.code, 'EX_002');
  close(pm.allocator.available('alpha'), 600);
});

test('heartbeat writes equity snapshots per bucket and portfolio', () => {
  const { pm, store } = makePortfolio();
  pm.init();
  pm.heartbeat();
  const api = new ControlApi({ portfolio: pm, store });
  close(api.getEquityHistory()[0].equity_usd, 1000);
  close(api.getEquityHistory({ bucketId: 'alpha' })[0].equity_usd, 600);
});

test('telegram commands go through ControlApi', async () => {
  const { pm, store } = makePortfolio();
  pm.init();
  const tg = new TelegramControl({ api: new ControlApi({ portfolio: pm, store }), token: null, chatId: null });
  assert.match(await tg.handle('/status'), /Portfolio/);
  await tg.handle('/pause beta testing');
  assert.equal(pm.bucketRisk.pauseState('beta').paused, true);
  await tg.handle('/resume beta');
  assert.equal(pm.bucketRisk.pauseState('beta').paused, false);
  assert.match(await tg.handle('/pause nope'), /Unknown bucket/);
});
