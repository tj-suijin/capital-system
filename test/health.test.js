import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ControlApi } from '../src/control/controlApi.js';
import { openStore } from '../src/persistence/db.js';
import { HealthMonitor } from '../src/portfolio/healthMonitor.js';
import { fakeClock, makePortfolio, testConfig } from './helpers.js';

const MIN = 60_000;

function monitor(config = {}) {
  const store = openStore();
  const clock = fakeClock();
  const alerts = [];
  const m = new HealthMonitor({ config, store, clock, emit: (e, p) => alerts.push({ e, ...p }) });
  return { m, store, clock, alerts };
}

test('health: a feed down for 10 minutes alerts once, and again when it recovers', () => {
  const { m, store, clock, alerts } = monitor({ dataDownAlertMs: 10 * MIN });
  const bucket = { id: 'b1', h: { ok: true }, health() { return this.h; } };

  m.checkBucket(bucket, clock());
  bucket.h = { ok: false, reason: 'price feed stale' };
  for (let i = 0; i < 9; i++) { m.checkBucket(bucket, clock()); clock.advance(MIN); }
  assert.equal(alerts.length, 0, 'short outages do not alert');
  for (let i = 0; i < 5; i++) { m.checkBucket(bucket, clock()); clock.advance(MIN); }
  assert.deepEqual(alerts.map(a => [a.e, a.type, a.bucketId, a.reason]), [['alert', 'DATA_DOWN', 'b1', 'price feed stale']]);

  bucket.h = { ok: true };
  m.checkBucket(bucket, clock());
  assert.equal(alerts[1].type, 'DATA_UP');
  assert.equal(alerts[1].downForMs, 14 * MIN);
  assert.deepEqual(store.eventsBetween(0, Infinity).map(e => e.type), ['DATA_DOWN', 'DATA_UP']);

  // A short blip after recovery stays quiet.
  bucket.h = { ok: false, reason: 'x' };
  m.checkBucket(bucket, clock());
  bucket.h = { ok: true };
  m.checkBucket(bucket, clock() + MIN);
  assert.equal(alerts.length, 2);
});

test('health: error bursts alert at most once per cooldown and ignore Telegram errors', () => {
  const { m, clock, alerts } = monitor({ errorBurst: { count: 3, windowMs: 10 * MIN, cooldownMs: 60 * MIN } });
  const err = mod => m.onError({ mod, msg: 'boom', code: 'DA_005', ts: clock() });

  for (let i = 0; i < 5; i++) err('TELEGRAM');
  assert.equal(alerts.length, 0);
  err('STREAM'); err('STREAM');
  assert.equal(alerts.length, 0);
  err('STREAM');
  assert.deepEqual([alerts[0].type, alerts[0].count, alerts[0].lastMod, alerts[0].lastCode], ['ERROR_BURST', 3, 'STREAM', 'DA_005']);
  for (let i = 0; i < 10; i++) err('STREAM');
  assert.equal(alerts.length, 1, 'cooldown');
  assert.equal(m.errorsSince(0), 13);

  clock.advance(61 * MIN);
  err('STREAM'); err('STREAM'); err('STREAM');
  assert.equal(alerts.length, 2);
  assert.equal(m.errorsSince(clock() - MIN), 3);
});

test('portfolio: records starts and clean stops, and spots an unclean previous stop', async () => {
  const store = openStore();
  const clock = fakeClock(Date.UTC(2026, 9, 14));
  const config = testConfig({ paperRun: { days: 7 } });

  const a = makePortfolio({ store, clock, config }).pm;
  await a.start();
  assert.equal(a.startInfo.previousExit, 'first');
  await a.stop();

  const b = makePortfolio({ store, clock, config }).pm;
  await b.start();
  assert.equal(b.startInfo.previousExit, 'clean');
  // b "crashes": stop() never runs.
  for (const t of b._timers) clearInterval(t);

  clock.advance(3 * 24 * 60 * MIN + MIN);
  const c = makePortfolio({ store, clock, config }).pm;
  await c.start();
  assert.equal(c.startInfo.previousExit, 'unclean');
  const api = new ControlApi({ portfolio: c, store });
  assert.equal(api.getStartInfo().previousExit, 'unclean');
  assert.deepEqual(
    { day: api.getRunInfo().day, days: api.getRunInfo().days, complete: api.getRunInfo().complete },
    { day: 4, days: 7, complete: false },
  );
  await c.stop();

  assert.deepEqual(store.eventsBetween(0, Infinity).map(e => [e.type, e.detail?.previousExit ?? null]),
    [['START', 'first'], ['STOP', null], ['START', 'clean'], ['START', 'unclean'], ['STOP', null]]);

  clock.advance(4 * 24 * 60 * MIN);
  assert.equal(api.getRunInfo().complete, true);
});

test('portfolio: operator actions and halts are recorded as system events', () => {
  const { pm, store } = makePortfolio();
  pm.init();
  pm.pauseBucket('alpha', 'test');
  pm.resumeBucket('alpha');
  pm.setWindDown(true);
  pm.halt('drill');
  pm.unhalt();
  assert.deepEqual(store.eventsBetween(0, Infinity).map(e => [e.type, e.bucket_id]),
    [['PAUSE', 'alpha'], ['RESUME', 'alpha'], ['WIND_DOWN', null], ['HALT', null], ['UNHALT', null]]);
});

test('portfolio: a bucket that stays unhealthy for 10 minutes raises an alert event', async () => {
  const { pm, registry, clock } = makePortfolio({ config: testConfig({ alerts: { dataDownAlertMs: 10 * MIN } }) });
  pm.init();
  const alerts = [];
  pm.events.on('alert', a => alerts.push(a));
  registry.get('alpha').health = () => ({ ok: false, reason: 'market data not running' });
  for (let i = 0; i <= 10; i++) { await pm.runBucketCycle('alpha'); clock.advance(MIN); }
  assert.deepEqual(alerts.map(a => [a.type, a.bucketId]), [['DATA_DOWN', 'alpha']]);
});
