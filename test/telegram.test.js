import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TelegramControl } from '../src/alerts/telegram.js';
import { tradeIntent } from '../src/buckets/intent.js';
import { ControlApi } from '../src/control/controlApi.js';
import { makePortfolio, testConfig } from './helpers.js';

const MIN = 60_000;

function setup({ fetchFn, digestTimes = [] } = {}) {
  const { pm, store, registry, clock } = makePortfolio({ config: testConfig({ paperRun: { days: 7 } }) });
  pm.init();
  const api = new ControlApi({ portfolio: pm, store });
  const sent = [];
  const fetch = fetchFn ?? (async (url, opts) => {
    sent.push(JSON.parse(opts.body).text);
    return { ok: true, json: async () => ({ ok: true }) };
  });
  const tg = new TelegramControl({ api, token: 't', chatId: '1', digestTimes, fetchFn: fetch, sleepFn: async () => {}, clock });
  return { pm, store, registry, clock, api, tg, sent };
}

test('telegram: poll errors back off (5s doubling to 5 min) instead of spinning', async () => {
  const waits = [];
  let polls = 0;
  const { api } = setup();
  const tg = new TelegramControl({
    api, token: 't', chatId: '1',
    fetchFn: async url => {
      if (!url.includes('getUpdates')) return { ok: true, json: async () => ({ ok: true }) };
      polls++;
      if (polls === 4) return { ok: true, json: async () => ({ ok: true, result: [] }) };
      return { ok: false, status: 409, json: async () => ({ ok: false, description: 'Conflict: terminated by other getUpdates request' }) };
    },
    sleepFn: async ms => { waits.push(ms); if (waits.length >= 10) tg._stop = true; },
  });
  await tg._poll();
  assert.deepEqual(waits, [5000, 10000, 20000, 5000, 10000, 20000, 40000, 80000, 160000, 300000]);
});

test('telegram: requests carry a timeout signal', async () => {
  const signals = [];
  const { tg } = setup({ fetchFn: async (url, opts) => { signals.push(opts?.signal); return { ok: true, json: async () => ({ ok: true }) }; } });
  await tg.send('hi');
  assert.ok(signals[0] instanceof AbortSignal);
});

test('telegram: the digest covers equity, trades, decisions, rejections and health', async () => {
  const { pm, registry, clock, tg } = setup();
  const start = clock();
  await pm.start();
  for (const t of pm._timers) clearInterval(t);
  registry.get('alpha').entries.push(tradeIntent({ symbol: 'ETH/USDC', price: 100, confidence: 1, stopLossPct: 0.02, reason: 'test' }));
  registry.get('alpha').marks['ETH/USDC'] = 100;
  clock.advance(MIN);
  await pm.runBucketCycle('alpha');
  const [p] = pm.store.getOpenPositions('alpha');
  registry.get('alpha').exits.push({ positionId: p.id, price: 101, reason: 'take profit 101' });
  clock.advance(MIN);
  await pm.runBucketCycle('alpha');
  await pm.runBucketCycle('beta');

  const text = tg.digest(start, 'last 12h');
  assert.match(text, /Digest<\/b> — run day 1 of 7, last 12h/);
  assert.match(text, /Equity \$1000\.\d\d \| HWM/);
  assert.match(text, /<b>Alpha<\/b>/);
  assert.match(text, /Trades: 1 opened, 1 closed \(1 won\), P&amp;L \+\$0\.\d\d/);
  assert.match(text, /Decisions: 3 — 2 no-trade, 1 opened, 0 rejected/);
  assert.match(text, /Top no-trade: script empty ×2/);
  assert.match(text, /Starts: 1 \(0 after an unclean stop\) \| Errors logged: 0 \| Memory \d+ MB/);
  await pm.stop();
});

test('telegram: digests go out once at each configured local time', async () => {
  const { tg, sent } = setup({ digestTimes: ['08:00', '21:00'] });
  const at = (h, m, s = 0) => new Date(2026, 9, 14, h, m, s);
  await tg._maybeDigest(at(7, 59, 50));
  await tg._maybeDigest(at(8, 0, 5));
  await tg._maybeDigest(at(8, 0, 35));
  await tg._maybeDigest(at(12, 0));
  await tg._maybeDigest(at(21, 0, 1));
  assert.equal(sent.length, 2);
  assert.match(sent[0], /since 20:00/);
  assert.match(sent[1], /since 08:00/);
});

test('telegram: alerts and the start message read clearly', () => {
  const { tg } = setup();
  assert.equal(tg.formatAlert({ type: 'DATA_DOWN', bucketId: 'liquidDirectional', downForMs: 10 * MIN, reason: 'price feed stale' }),
    '📡 <b>DATA DOWN</b> [liquidDirectional] for 10m: price feed stale\nNo entries or exits for this feed until it recovers.');
  assert.equal(tg.formatAlert({ type: 'DATA_UP', bucketId: 'liquidDirectional', downForMs: 23 * MIN }), '📡 Data back [liquidDirectional] after 23m');
  assert.match(tg.formatAlert({ type: 'ERROR_BURST', count: 12, windowMs: 10 * MIN, lastMod: 'STREAM', lastMsg: 'Reconnect failed', lastCode: 'DA_005' }),
    /12 in the last 10m\nLatest: \[STREAM\] Reconnect failed \(DA_005\)/);

  tg.api.pm.startInfo = { previousExit: 'unclean', openPositions: 2 };
  tg.digestTimes = ['08:00', '21:00'];
  assert.match(tg._startMessage(), /did not shut down cleanly \(crash, kill or reboot\)\. Open positions: 2\nDigests at 08:00 and 21:00/);
});

test('telegram: /digest takes an optional number of hours', async () => {
  const { tg } = setup();
  assert.match(await tg.handle('/digest'), /last 12h/);
  assert.match(await tg.handle('/digest 48'), /last 48h/);
  assert.equal(await tg.handle('/digest abc'), 'Usage: /digest [hours]');
});
