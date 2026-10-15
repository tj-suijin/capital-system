// Telegram control plane — a thin client of ControlApi.
// Outbound: fills, closes, halts, controls, health alerts and scheduled
// digests. Inbound: operator commands. Only messages from TELEGRAM_CHAT_ID
// are accepted.
import { CONFIG } from '../../config/portfolio.js';
import { E } from '../shared/errors.js';
import { createLogger } from '../shared/logger.js';

const log = createLogger('TELEGRAM');
const CODE_MSG = Object.fromEntries(Object.values(E).map(d => [d.code, d.msg]));

const SEND_TIMEOUT_MS = 15_000;
const POLL_WAIT_S     = 25;
const POLL_TIMEOUT_MS = (POLL_WAIT_S + 10) * 1000;
const MIN_BACKOFF_MS  = 5_000;
const MAX_BACKOFF_MS  = 5 * 60_000;
const DIGEST_CHECK_MS = 30_000;
const HOUR            = 3_600_000;

const HELP = [
  '<b>Commands</b>',
  '/status — portfolio + every bucket',
  '/buckets — bucket list with the IDs the commands below take',
  '/positions [bucket] — open positions at the latest price',
  '/decisions [bucket] — last 5 decisions',
  '/digest [hours] — summary of the last hours (default 12)',
  '/pause &lt;bucket&gt; — stop new entries for one bucket',
  '/resume &lt;bucket&gt; — resume one bucket',
  '/winddown [off] — no new entries anywhere; exits continue',
  '/halt — global kill switch',
  '/unhalt — clear halt (resets high-water mark)',
  '/help — this message',
].join('\n');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const usd = n => `$${(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = n => `${((n ?? 0) * 100).toFixed(2)}%`;
const signedUsd = n => `${n < 0 ? '-' : '+'}${usd(Math.abs(n ?? 0))}`;
const words = s => String(s ?? '').replace(/_/g, ' ');
const regimeLabel = r => words(r).toLowerCase().replace(/^\w/, c => c.toUpperCase());
const age = ms => (ms < 120_000 ? `${Math.round(ms / 1000)}s` : ms < 7_200_000 ? `${Math.round(ms / 60_000)}m` : `${(ms / 3_600_000).toFixed(1)}h`);
const short = (s, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const localHhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class TelegramControl {
  constructor({
    api,
    token       = process.env.TELEGRAM_BOT_TOKEN,
    chatId      = process.env.TELEGRAM_CHAT_ID,
    digestTimes = CONFIG.alerts?.digestTimes ?? [],
    fetchFn     = globalThis.fetch,
    sleepFn     = sleep,
    clock       = Date.now,
  }) {
    this.api         = api;
    this.token       = token;
    this.chatId      = chatId;
    this.active      = !!(token && chatId);
    this.digestTimes = digestTimes;
    this._fetch      = fetchFn;
    this._sleep      = sleepFn;
    this.clock       = clock;
    this._offset     = 0;
    this._stop       = false;
    this._unsubs     = [];
    this._digestTimer   = null;
    this._lastDigestKey = null;
    this._lastDigestAt  = null;
  }

  start() {
    if (!this.active) {
      log.warn('Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing) — control plane disabled');
      return;
    }
    this._unsubs.push(
      this.api.on('fill',  e => this.send(`🟢 <b>OPEN</b> [${this._name(e.bucketId)}] ${esc(e.position.symbol)}\nSize: ${usd(e.position.notional_usd)} @ ${e.position.entry_price.toFixed(2)}\n${esc(words(e.position.intent_reason))}`)),
      this.api.on('close', e => this.send(`${e.pnlUsd >= 0 ? '✅' : '🔴'} <b>CLOSE</b> [${this._name(e.bucketId)}] ${esc(e.position.symbol)}\nP&amp;L: ${signedUsd(e.pnlUsd)}\n${esc(words(e.position.exit_reason))}`)),
      this.api.on('risk',  e => this.send(`🛑 <b>HALT</b>\n${esc(e.reason)}`)),
      this.api.on('control', e => this.send(`⚙️ ${esc(words(e.type))}${e.bucketId ? ` [${this._name(e.bucketId)}]` : ''}`)),
      this.api.on('alert', e => this.send(this.formatAlert(e))),
    );
    this._poll();
    if (this.digestTimes.length) this._digestTimer = setInterval(() => this._maybeDigest(new Date(this.clock())), DIGEST_CHECK_MS);
    this.send(this._startMessage());
    log.info({ digestTimes: this.digestTimes }, 'Telegram control plane active');
  }

  async stop() {
    this._stop = true;
    clearInterval(this._digestTimer);
    for (const u of this._unsubs) u();
    if (this.active) await this.send('Capital system stopped.');
  }

  async send(text) {
    if (!this.active) return;
    try {
      const res = await this._fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ chat_id: this.chatId, text, parse_mode: 'HTML' }),
        signal:  AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok) log.warn({ status: res.status }, 'Telegram send failed');
    } catch (err) {
      log.error({ err: err.message }, 'Telegram send error');
    }
  }

  // Error replies (401 revoked token, 409 another copy polling, 429) and
  // network failures back off from 5s up to 5 minutes instead of spinning.
  async _poll() {
    let backoff = 0;
    while (!this._stop) {
      try {
        const res  = await this._fetch(`https://api.telegram.org/bot${this.token}/getUpdates?offset=${this._offset + 1}&timeout=${POLL_WAIT_S}`, {
          signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) throw new Error(`HTTP ${res.status}${data?.description ? `: ${data.description}` : ''}`);
        backoff = 0;
        for (const u of data.result ?? []) {
          this._offset = u.update_id;
          const msg = u.message;
          if (!msg || String(msg.chat.id) !== String(this.chatId)) continue;
          await this.handle(msg.text?.trim() ?? '');
        }
      } catch (err) {
        if (this._stop) break;
        backoff = Math.min(backoff ? backoff * 2 : MIN_BACKOFF_MS, MAX_BACKOFF_MS);
        log.warn({ err: err.message, retryMs: backoff }, 'Telegram poll error');
        await this._sleep(backoff);
      }
    }
  }

  // Returns the reply text (also sent). Exposed for testing.
  async handle(text) {
    const [rawCmd, ...args] = text.split(/\s+/);
    const cmd = (rawCmd ?? '').toLowerCase().replace(/@.*$/, '');
    let reply;
    try {
      reply = this._dispatch(cmd, args);
    } catch (err) {
      reply = `⚠️ ${esc(err.message)}`;
    }
    if (reply) await this.send(reply);
    return reply;
  }

  _dispatch(cmd, args) {
    switch (cmd) {
      case '/status': case '/s':  return this._status();
      case '/buckets': case '/b': return this._buckets();
      case '/positions': case '/p': return this._positions(args[0]);
      case '/decisions': case '/d': return this._decisions(args[0]);
      case '/digest': {
        const hours = Number(args[0] ?? 12);
        if (!(hours > 0 && hours <= 24 * 30)) return 'Usage: /digest [hours]';
        return this.digest(this.clock() - hours * HOUR, `last ${hours}h`);
      }
      case '/pause':
        if (!args[0]) return 'Usage: /pause &lt;bucket&gt;';
        this.api.pause(args[0], args.slice(1).join(' ') || 'telegram pause');
        return `⏸ Paused <b>${esc(args[0])}</b>`;
      case '/resume':
        if (!args[0]) return 'Usage: /resume &lt;bucket&gt;';
        this.api.resume(args[0]);
        return `▶️ Resumed <b>${esc(args[0])}</b>`;
      case '/winddown': case '/wd': {
        const off = args[0]?.toLowerCase() === 'off';
        this.api.windDown(!off);
        return off ? '▶️ Wind-down off — entries allowed' : '⏳ Wind-down on — no new entries, exits continue';
      }
      case '/halt':
        this.api.halt(args.join(' ') || 'telegram halt');
        return null; // the 'risk' event sends the HALT message
      case '/unhalt':
        this.api.unhalt();
        return '✅ Unhalted — high-water mark reset to current equity';
      case '/help': case '/h': case '/start':
        return HELP;
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------- digest

  // Sends once per configured local time. Exposed for testing.
  async _maybeDigest(date) {
    const hhmm = localHhmm(date);
    if (!this.digestTimes.includes(hhmm)) return;
    const key = `${date.toDateString()} ${hhmm}`;
    if (key === this._lastDigestKey) return;
    this._lastDigestKey = key;
    const now   = date.getTime();
    const since = this._lastDigestAt ?? now - 12 * HOUR;
    this._lastDigestAt = now;
    try {
      await this.send(this.digest(since, `since ${localHhmm(new Date(since))}`));
    } catch (err) {
      log.error({ err: err.message }, 'Digest failed');
    }
  }

  digest(sinceMs, label) {
    const s    = this.api.getStatus();
    const run  = this.api.getRunInfo();
    const sum  = this.api.getRunSummary({ sinceMs });
    const r    = s.risk;
    const ev   = sum.events;
    const lines = [
      `📋 <b>Digest</b> — ${run.day ? `run day ${run.day}${run.days ? ` of ${run.days}` : ''}, ` : ''}${esc(label)}${r.halted ? ' 🛑 HALTED' : ''}${s.windingDown ? ' ⏳ WIND-DOWN' : ''}`,
      `Equity ${usd(r.equityUsd)} | Drawdown ${pct(r.drawdownPct)} | Exposure ${pct(r.grossExposurePct)}`,
    ];
    if (run.complete) lines.push(`✅ The ${run.days}-day paper run is complete. Run <code>npm run report</code> and review.`);

    for (const b of s.buckets) {
      if (b.detail?.placeholder) continue;
      const t = sum.trades[b.id];
      const d = sum.buckets[b.id];
      lines.push('', `${b.paused ? '⏸' : '▶️'} <b>${esc(b.name)}</b>: ${usd(b.equityUsd)}, ${b.openPositions} open${b.openPositions ? ` (${signedUsd(b.unrealizedPnlUsd)})` : ''}`);
      lines.push(t
        ? `  Trades: ${t.opened} opened, ${t.closed} closed (${t.wins} won), P&amp;L ${signedUsd(t.pnlUsd)}, fees ${usd(t.feesUsd)}`
        : '  Trades: none');
      if (!d) continue;
      const c = d.counts;
      lines.push(`  Decisions: ${d.total} — ${c.NO_TRADE ?? 0} no-trade, ${c.APPROVED ?? 0} opened, ${c.REJECTED ?? 0} rejected${c.ERROR ? `, ${c.ERROR} errors` : ''}`);
      const top = d.topNoTrade.slice(0, 3).map(x => `${esc(short(words(x.reason)))} ×${x.n}`);
      if (top.length) lines.push(`  Top no-trade: ${top.join('; ')}`);
      const rej = Object.entries(d.rejections).map(([k, n]) => `${esc(CODE_MSG[k.split(' ').at(-1)] ?? k)} ×${n}`);
      if (rej.length) lines.push(`  Rejected: ${rej.join('; ')}`);
      const min = b.detail?.minConfidence;
      if (min != null && d.nearMisses.length) {
        const close = d.nearMisses.filter(x => x >= min - 0.05).length;
        lines.push(`  Near misses: best ${pct(d.nearMisses[0])}, ${close} within 5 points of ${pct(min)}`);
      }
    }
    const idle = this._idleLines();
    if (idle.length) lines.push('', ...idle);

    const feeds = Object.entries(sum.health).filter(([, h]) => h.reconnects != null || !h.ok);
    const stale = Object.values(sum.buckets).reduce((n, b) => n + b.staleMinutes, 0);
    lines.push('', '<b>Health</b>');
    for (const [id, h] of feeds) {
      lines.push(`  Feed [${this._name(id)}]: ${h.ok ? 'live' : `⚠️ ${esc(h.reason)}`}, ${h.reconnects ?? 0} reconnects since start`);
    }
    lines.push(`  Stale-feed minutes: ${stale} | Outages over ${Math.round((CONFIG.alerts?.dataDownAlertMs ?? 0) / 60_000)}m: ${ev.dataDown.length}`);
    lines.push(`  Starts: ${ev.starts.length} (${ev.unclean.length} after an unclean stop) | Errors logged: ${sum.errorsLogged} | Memory ${sum.memoryMb} MB`);
    if (ev.halts.length || ev.controls.length) lines.push(`  Halts: ${ev.halts.length} | Operator actions: ${ev.controls.map(e => esc(e.type)).join(', ') || 'none'}`);
    return lines.join('\n');
  }

  // ---------------------------------------------------------------- alerts

  formatAlert(e) {
    switch (e.type) {
      case 'DATA_DOWN':
        return `📡 <b>DATA DOWN</b> [${this._name(e.bucketId)}] for ${age(e.downForMs)}: ${esc(e.reason)}\nNo entries or exits for this feed until it recovers.`;
      case 'DATA_UP':
        return `📡 Data back [${this._name(e.bucketId)}] after ${age(e.downForMs)}`;
      case 'ERROR_BURST':
        return `⚠️ <b>Errors</b>: ${e.count} in the last ${age(e.windowMs)}\nLatest: [${esc(e.lastMod)}] ${esc(e.lastMsg)}${e.lastCode ? ` (${esc(e.lastCode)})` : ''}`;
      default:
        return `⚠️ ${esc(e.type)}${e.bucketId ? ` [${this._name(e.bucketId)}]` : ''}`;
    }
  }

  _startMessage() {
    const run   = this.api.getRunInfo();
    const start = this.api.getStartInfo();
    const lines = ['🤖 <b>Capital system started</b> (paper-first)'];
    if (run.day) lines.push(`Run day ${run.day}${run.days ? ` of ${run.days}` : ''}`);
    if (start?.previousExit === 'unclean') {
      lines.push(`⚠️ The previous run did not shut down cleanly (crash, kill or reboot). Open positions: ${start.openPositions}`);
    }
    const buckets = this.api.listBuckets();
    const on  = buckets.filter(b => b.state === 'on').map(b => `${esc(b.name)} (${esc(b.mode)})`);
    const off = buckets.filter(b => b.state !== 'on').map(b => esc(b.name));
    if (on.length)  lines.push(`Running: ${on.join(', ')}`);
    if (off.length) lines.push(`Off: ${off.join(', ')}`);
    if (this.digestTimes.length) lines.push(`Digests at ${this.digestTimes.join(' and ')}`);
    return lines.join('\n');
  }

  _name(bucketId) {
    return esc(this.api.getBucketNames()[bucketId] ?? bucketId);
  }

  // One line per bucket that is off or only a placeholder.
  _idleLines() {
    return this.api.listBuckets()
      .filter(b => b.state !== 'on')
      .map(b => `⚪ ${esc(b.name)}: ${b.state === 'off' ? 'OFF' : 'NOT BUILT'}`);
  }

  // --------------------------------------------------------------- commands

  _status() {
    const s = this.api.getStatus();
    const r = s.risk;
    const lines = [
      `📊 <b>Portfolio</b> (${esc(s.mode)})${r.halted ? ' 🛑 HALTED' : ''}${s.windingDown ? ' ⏳ WIND-DOWN' : ''}`,
      `Equity ${usd(r.equityUsd)} | Drawdown ${pct(r.drawdownPct)} | Exposure ${pct(r.grossExposurePct)}`,
      `P&amp;L 24h ${signedUsd(r.pnl24hUsd)} | 7d ${signedUsd(r.pnl7dUsd)} | Reserve ${usd(s.reserve?.equityUsd)}`,
      '',
    ];
    for (const b of s.buckets) {
      if (b.detail?.placeholder) continue;
      const paused = b.paused ? ` PAUSED${b.pauseReason ? `: ${esc(b.pauseReason)}` : ''}` : '';
      lines.push(
        `${b.paused ? '⏸' : '▶️'} <b>${esc(b.name)}</b> (${esc(b.mode)})${paused}`,
        `  ${usd(b.equityUsd)} | ${b.openPositions} open${b.openPositions ? ` (${signedUsd(b.unrealizedPnlUsd)})` : ''} | P&amp;L 24h ${signedUsd(b.pnl24hUsd)}`,
      );
      if (b.detail?.regime) {
        lines.push(`  ${regimeLabel(b.detail.regime.regime)} ${Math.round(b.detail.regime.confidence * 100)}%: ${esc(words(b.detail.lastView))}`);
      } else if (b.detail?.ready === false) {
        lines.push(`  ⚠️ Market data not running${b.detail.startError ? `: ${esc(b.detail.startError)}` : ''}`);
      }
    }
    lines.push(...this._idleLines());
    return lines.join('\n');
  }

  _buckets() {
    return ['<b>Buckets</b> (use the ID in /pause, /resume, /positions and /decisions)', ...this.api.listBuckets().map(b => {
      if (b.state !== 'on') return `⚪ ${esc(b.name)} [${esc(b.id)}]: ${b.state === 'off' ? 'OFF' : 'NOT BUILT'}`;
      return `${b.paused ? '⏸' : '▶️'} ${esc(b.name)} [${esc(b.id)}]: ${esc(b.mode)} | ${usd(b.equityUsd)} | ${b.openPositions} open`;
    })].join('\n');
  }

  _positions(bucketId) {
    const rows = this.api.getOpenPositions({ bucketId: bucketId ?? null });
    if (!rows.length) return 'No open positions.';
    return ['<b>Open positions</b>', ...rows.map(p => [
      `#${p.id} [${this._name(p.bucket_id)}] ${esc(p.symbol)} ${usd(p.notional_usd)} @ ${p.entry_price.toFixed(2)}`,
      p.priced
        ? `  Mark ${p.markPrice.toFixed(2)}${p.markAgeMs != null ? ` (${age(p.markAgeMs)} old)` : ''} | P&amp;L ${signedUsd(p.unrealizedPnlUsd)}`
        : '  No price — valued at cost',
      `  Stop ${p.stop_loss?.toFixed(2) ?? '—'} | Target ${p.take_profit?.toFixed(2) ?? '—'} | Held ${age(p.heldMs)}`,
    ].join('\n'))].join('\n');
  }

  _decisions(bucketId) {
    const rows = this.api.getDecisions({ bucketId: bucketId ?? null, limit: 5 });
    if (!rows.length) return 'No decisions yet.';
    return ['<b>Recent decisions</b>', ...rows.map(d =>
      `${localHhmm(new Date(d.ts))} [${this._name(d.bucket_id)}] ${esc(words(d.outcome).toLowerCase())}: ${esc(words(d.reason))}`)].join('\n');
  }
}

export default TelegramControl;
