// Telegram control plane — a thin client of ControlApi.
// Outbound: fills, closes, halts, controls. Inbound: operator commands.
// Only messages from TELEGRAM_CHAT_ID are accepted.
import { createLogger } from '../shared/logger.js';

const log = createLogger('TELEGRAM');

const HELP = [
  '<b>Commands</b>',
  '/status — portfolio + every bucket',
  '/buckets — bucket list',
  '/decisions [bucket] — last 5 decisions',
  '/pause &lt;bucket&gt; — stop new entries for one bucket',
  '/resume &lt;bucket&gt; — resume one bucket',
  '/winddown [off] — no new entries anywhere; exits continue',
  '/halt — global kill switch',
  '/unhalt — clear halt (resets high-water mark)',
  '/help — this message',
].join('\n');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const usd = n => `$${(n ?? 0).toFixed(2)}`;
const pct = n => `${((n ?? 0) * 100).toFixed(2)}%`;

export class TelegramControl {
  constructor({ api, token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID }) {
    this.api     = api;
    this.token   = token;
    this.chatId  = chatId;
    this.active  = !!(token && chatId);
    this._offset = 0;
    this._stop   = false;
    this._unsubs = [];
  }

  start() {
    if (!this.active) {
      log.warn('Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing) — control plane disabled');
      return;
    }
    this._unsubs.push(
      this.api.on('fill',  e => this.send(`🟢 <b>OPEN</b> [${esc(e.bucketId)}] ${esc(e.position.symbol)}\nSize: ${usd(e.position.notional_usd)} @ ${e.position.entry_price.toFixed(4)}\n${esc(e.position.intent_reason)}`)),
      this.api.on('close', e => this.send(`${e.pnlUsd >= 0 ? '✅' : '🔴'} <b>CLOSE</b> [${esc(e.bucketId)}] ${esc(e.position.symbol)}\nP&amp;L: ${usd(e.pnlUsd)}\n${esc(e.position.exit_reason)}`)),
      this.api.on('risk',  e => this.send(`🛑 <b>HALT</b>\n${esc(e.reason)}`)),
      this.api.on('control', e => this.send(`⚙️ ${esc(e.type)}${e.bucketId ? ` [${esc(e.bucketId)}]` : ''}`)),
    );
    this._poll();
    this.send('🤖 <b>Capital system started</b> (paper-first)');
    log.info('Telegram control plane active');
  }

  async stop() {
    this._stop = true;
    for (const u of this._unsubs) u();
    if (this.active) await this.send('Capital system stopped.');
  }

  async send(text) {
    if (!this.active) return;
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ chat_id: this.chatId, text, parse_mode: 'HTML' }),
      });
      if (!res.ok) log.warn({ status: res.status }, 'Telegram send failed');
    } catch (err) {
      log.error({ err: err.message }, 'Telegram send error');
    }
  }

  async _poll() {
    while (!this._stop) {
      try {
        const res  = await fetch(`https://api.telegram.org/bot${this.token}/getUpdates?offset=${this._offset + 1}&timeout=25`);
        const data = await res.json();
        for (const u of data.result ?? []) {
          this._offset = u.update_id;
          const msg = u.message;
          if (!msg || String(msg.chat.id) !== String(this.chatId)) continue;
          await this.handle(msg.text?.trim() ?? '');
        }
      } catch (err) {
        log.warn({ err: err.message }, 'Telegram poll error');
        await new Promise(r => setTimeout(r, 5000));
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
      case '/decisions': case '/d': return this._decisions(args[0]);
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

  _status() {
    const s = this.api.getStatus();
    const r = s.risk;
    const lines = [
      `📊 <b>Portfolio</b> (${esc(s.mode)})${r.halted ? ' 🛑 HALTED' : ''}${s.windingDown ? ' ⏳ WIND-DOWN' : ''}`,
      `Equity: ${usd(r.equityUsd)} | HWM: ${usd(r.hwmUsd)} | DD: ${pct(r.drawdownPct)}`,
      `Exposure: ${pct(r.grossExposurePct)} | 24h: ${usd(r.pnl24hUsd)} | 7d: ${usd(r.pnl7dUsd)}`,
      `Reserve: ${usd(s.reserve?.equityUsd)}`,
      '',
    ];
    for (const b of s.buckets) {
      const d = b.decisions24h;
      lines.push(
        `<b>${esc(b.name)}</b> [${esc(b.id)}] ${esc(b.mode)}${b.paused ? ' ⏸' : ''}`,
        `  Equity ${usd(b.equityUsd)} | P&amp;L ${usd(b.realizedPnlUsd)} | Open ${b.openPositions}`,
        `  24h: ${d.NO_TRADE ?? 0} no-trade, ${d.REJECTED ?? 0} rejected, ${d.APPROVED ?? 0} opened`,
      );
      if (b.detail?.regime) {
        lines.push(`  Regime: ${esc(b.detail.regime.regime)} ${pct(b.detail.regime.confidence)} — ${esc(b.detail.lastView)}`);
      } else if (b.detail?.ready === false) {
        lines.push(`  ⚠️ Market data not running${b.detail.startError ? `: ${esc(b.detail.startError)}` : ''}`);
      }
    }
    return lines.join('\n');
  }

  _buckets() {
    return ['<b>Buckets</b>', ...this.api.listBuckets().map(b =>
      `${b.paused ? '⏸' : '▶️'} ${esc(b.id)} — ${esc(b.mode)} — ${usd(b.equityUsd)} — ${b.openPositions} open`)].join('\n');
  }

  _decisions(bucketId) {
    const rows = this.api.getDecisions({ bucketId: bucketId ?? null, limit: 5 });
    if (!rows.length) return 'No decisions yet.';
    return ['<b>Recent decisions</b>', ...rows.map(d =>
      `${new Date(d.ts).toISOString().slice(5, 16).replace('T', ' ')} [${esc(d.bucket_id)}] ${esc(d.outcome)} — ${esc(d.reason)}`)].join('\n');
  }
}

export default TelegramControl;
