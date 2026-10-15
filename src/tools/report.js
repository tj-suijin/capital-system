// npm run report [-- --since <ISO time>] [--until <ISO time>]
//
// Read-only summary of the paper run, for the end-of-run review. Defaults to
// the whole run (from settings.runStartedAt) up to now. Prints Markdown and
// saves it to reports/. Safe to run while the system is running.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG } from '../../config/portfolio.js';
import { summarizeWindow } from '../portfolio/runSummary.js';

const MIN = 60_000;
const HOUR = 60 * MIN;

const usd = n => `${n < 0 ? '-' : ''}$${Math.abs(n ?? 0).toFixed(2)}`;
const pct = (n, d = 2) => `${((n ?? 0) * 100).toFixed(d)}%`;
const when = ts => (ts == null ? '—' : new Date(ts).toLocaleString('en-US', { hour12: false }));
const dur = ms => (ms < 2 * HOUR ? `${Math.round(ms / MIN)}m` : `${(ms / HOUR).toFixed(1)}h`);
const table = (head, rows) => [
  `| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.join(' | ')} |`),
].join('\n');

// JSON log lines between sinceMs and untilMs. Missing files are empty.
function readLogLines(file, sinceMs, untilMs) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      const j = JSON.parse(line);
      if (j.time >= sinceMs && j.time < untilMs) out.push(j);
    } catch { /* partial line */ }
  }
  return out;
}

function fileMb(file) {
  try { return fs.statSync(file).size / 1048576; } catch { return 0; }
}

function maxDrawdown(snaps) {
  let peak = -Infinity, worst = 0;
  for (const s of snaps) {
    peak = Math.max(peak, s.equity_usd);
    if (peak > 0) worst = Math.max(worst, (peak - s.equity_usd) / peak);
  }
  return worst;
}

export function buildReport({ store, config = CONFIG, sinceMs, untilMs, logDir = config.log.dir, dbPath = config.db.path }) {
  const sum  = summarizeWindow({ store, sinceMs, untilMs });
  const out  = [];
  const span = untilMs - sinceMs;
  const pool = config.buckets.majorsTrader?.market?.pool;

  out.push(`# Paper run report`, '');
  out.push(`Window: ${when(sinceMs)} to ${when(untilMs)} (${(span / (24 * HOUR)).toFixed(2)} days${config.paperRun?.days ? ` of ${config.paperRun.days} planned` : ''}).`, '');
  out.push('A few days of trading cannot show whether a strategy has an edge. This report checks that the system ran unattended and behaved as designed.', '');

  // ---- Operation
  const snaps = store.equitySnapshotsBetween('portfolio', sinceMs, untilMs);
  const hb = config.heartbeatIntervalMs;
  const gaps = [];
  let prev = sinceMs;
  for (const s of [...snaps, { ts: untilMs }]) {
    if (s.ts - prev > 2 * hb) gaps.push({ from: prev, to: s.ts });
    prev = s.ts;
  }
  const covered = Math.max(0, span - gaps.reduce((n, g) => n + (g.to - g.from), 0));
  const ev = sum.events;
  out.push('## Operation', '');
  out.push(`- Heartbeat coverage: ${pct(covered / span, 1)} (${snaps.length} snapshots, one expected every ${dur(hb)}).`);
  out.push(`- Process starts: ${ev.starts.length}, of which ${ev.unclean.length} followed an unclean stop (crash, kill or reboot). Clean stops: ${ev.stops.length}.`);
  out.push(`- Data outages longer than ${dur(config.alerts?.dataDownAlertMs ?? 10 * MIN)}: ${ev.dataDown.length}. Error bursts: ${ev.errorBursts.length}. Halts: ${ev.halts.length}.`);
  const staleMin = Object.values(sum.buckets).reduce((n, b) => n + b.staleMinutes, 0);
  out.push(`- Minutes with a stale or not-yet-live feed (bucket cycles that said so): ${staleMin}.`);
  if (gaps.length) {
    out.push('', 'Gaps in the heartbeat (the system was not running, or was stuck):', '');
    out.push(table(['From', 'To', 'Length'], gaps.map(g => [when(g.from), when(g.to), dur(g.to - g.from)])));
  }
  if (ev.dataUp.length) {
    out.push('', 'Data outages:', '');
    out.push(table(['Bucket', 'Down at', 'Length'], ev.dataUp.map(e => [e.bucket_id, when(e.detail?.downSince), dur(e.detail?.downForMs ?? 0)])));
  }
  if (ev.controls.length) {
    out.push('', `Operator actions: ${ev.controls.map(e => `${e.type}${e.bucket_id ? ` [${e.bucket_id}]` : ''} at ${when(e.ts)}`).join('; ')}.`);
  }

  const app = readLogLines(path.join(logDir, 'app.log'), sinceMs, untilMs);
  const beats = app.filter(l => l.msg === 'Heartbeat' && l.rssMb != null);
  if (beats.length) {
    const rss = beats.map(b => b.rssMb);
    out.push(`- Memory (resident): first ${rss[0]} MB, last ${rss.at(-1)} MB, highest ${Math.max(...rss)} MB.`);
  }
  const errs = readLogLines(path.join(logDir, 'errors.log'), sinceMs, untilMs);
  const errGroups = {};
  for (const e of errs) {
    const k = `${e.mod ?? '?'} ${e.code ?? ''} ${e.msg ?? ''}`.replace(/\s+/g, ' ').trim();
    errGroups[k] = (errGroups[k] ?? 0) + 1;
  }
  out.push(`- Error log lines: ${errs.length}.`);
  if (errs.length) out.push('', table(['Error', 'Count'], Object.entries(errGroups).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, n])), '');
  out.push(`- Disk: database ${(fileMb(dbPath) + fileMb(`${dbPath}-wal`)).toFixed(1)} MB, app.log ${fileMb(path.join(logDir, 'app.log')).toFixed(1)} MB, errors.log ${fileMb(path.join(logDir, 'errors.log')).toFixed(1)} MB.`);
  out.push('- Alchemy usage: check the Alchemy dashboard by hand.', '');

  // ---- Per bucket
  for (const [id, b] of Object.entries(sum.buckets)) {
    const name = config.buckets[id]?.name ?? id;
    const bs = store.equitySnapshotsBetween(id, sinceMs, untilMs);
    out.push(`## ${name} (\`${id}\`)`, '');
    if (bs.length) {
      const first = bs[0].equity_usd, last = bs.at(-1).equity_usd;
      out.push(`- Equity: ${usd(first)} to ${usd(last)} (${pct((last - first) / first)}). Largest drop from a peak: ${pct(maxDrawdown(bs))}.`);
    }
    const c = b.counts;
    out.push(`- Decisions: ${b.total}. No trade ${c.NO_TRADE ?? 0}, opened ${c.APPROVED ?? 0}, rejected ${c.REJECTED ?? 0}, shadow ${c.SHADOW ?? 0}, errors ${c.ERROR ?? 0}.`);
    const regimeTotal = Object.values(b.regimes).reduce((n, x) => n + x, 0);
    if (regimeTotal) {
      out.push(`- Regime (inferred from reasons, ${regimeTotal} minutes): ${Object.entries(b.regimes).sort((x, y) => y[1] - x[1]).map(([r, n]) => `${r} ${pct(n / regimeTotal, 0)}`).join(', ')}.`);
    }
    if (b.nearMisses.length) {
      const hist = {};
      for (const x of b.nearMisses) { const k = Math.floor(x * 20) * 5; hist[k] = (hist[k] ?? 0) + 1; }
      out.push(`- Near misses (confidence below the minimum): ${b.nearMisses.length} minutes, best ${pct(b.nearMisses[0], 0)}. By band: ${Object.entries(hist).sort((x, y) => y[0] - x[0]).map(([k, n]) => `${k}–${Number(k) + 5}%: ${n}`).join(', ')}.`);
    }
    if (Object.keys(b.rejections).length) {
      out.push('', table(['Rejected at', 'Count'], Object.entries(b.rejections).sort((x, y) => y[1] - x[1]).map(([k, n]) => [k, n])));
    }
    if (b.topNoTrade.length) {
      out.push('', 'Top no-trade reasons (numbers replaced by #):', '');
      out.push(table(['Reason', 'Minutes'], b.topNoTrade.slice(0, 12).map(x => [x.reason.replace(/\|/g, '/'), x.n])));
    }
    if (b.errors.length) out.push('', `Cycle errors: ${b.errors.map(e => `${e.reason} ×${e.n}`).join('; ')}`);

    const t = sum.trades[id];
    const closed = sum.closed.filter(p => p.bucket_id === id);
    out.push('');
    if (!t) {
      out.push('No trades.', '');
      continue;
    }
    const wins = closed.filter(p => p.pnl_usd > 0), losses = closed.filter(p => p.pnl_usd <= 0);
    const avg = xs => (xs.length ? xs.reduce((n, p) => n + p.pnl_usd, 0) / xs.length : 0);
    out.push(`- Trades: ${t.opened} opened, ${t.closed} closed. Won ${t.wins} (${pct(t.closed ? t.wins / t.closed : 0, 0)}). Average win ${usd(avg(wins))}, average loss ${usd(avg(losses))}.`);
    out.push(`- Net P&L ${usd(t.pnlUsd)} after ${usd(t.feesUsd)} in fees (${usd(t.pnlUsd + t.feesUsd)} before fees; slippage is inside the fill prices).`);
    out.push(`- Exits: ${Object.entries(t.byExit).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}.`);
    if (closed.length) {
      const rows = closed.slice(-40).map(p => {
        const candle = pool ? store.getFirstCandleFrom(pool, '1m', Math.floor(p.opened_at / MIN) * MIN) : null;
        const vsClose = candle ? pct(p.entry_price / candle.close - 1) : '—';
        return [p.id, when(p.opened_at), dur(p.closed_at - p.opened_at), p.tag ?? '', p.entry_price.toFixed(2), p.exit_price.toFixed(2),
          usd(p.notional_usd), usd(p.pnl_usd), pct(p.pnl_usd / p.notional_usd), vsClose, (p.exit_reason ?? '').replace(/\|/g, '/')];
      });
      out.push('', closed.length > 40 ? `Last 40 of ${closed.length} closed trades:` : 'Closed trades:', '');
      out.push(table(['#', 'Opened', 'Held', 'Tag', 'Entry', 'Exit', 'Size', 'P&L', 'P&L %', 'Fill vs minute close', 'Exit reason'], rows));
    }
    out.push('');
  }

  // ---- Benchmark
  if (pool) {
    const a = store.getFirstCandleFrom(pool, '1m', sinceMs);
    const z = store.getLastCandle(pool, '1m', untilMs);
    if (a && z) {
      out.push('## Benchmark', '');
      out.push(`Holding ETH over the window: ${a.close.toFixed(2)} to ${z.close.toFixed(2)} (${pct(z.close / a.close - 1)}). Bucket 1 is at most about 20% invested, so compare its P&L in dollars, not as a percentage of the bucket.`, '');
    }
  }
  return out.join('\n');
}

async function main() {
  const { getStore } = await import('../persistence/db.js');
  const args = process.argv.slice(2);
  const arg  = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const store = getStore();
  const untilMs = arg('--until') ? Date.parse(arg('--until')) : Date.now();
  const sinceMs = arg('--since') ? Date.parse(arg('--since')) : Number(store.getSetting('runStartedAt') ?? 0);
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || sinceMs >= untilMs) {
    console.error('Invalid window. Use --since and --until with ISO times, e.g. --since 2026-10-14T08:00');
    process.exitCode = 1;
    return;
  }
  const md = buildReport({ store, sinceMs, untilMs });
  store.close();
  const d = new Date(untilMs);
  const stamp = [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(n => String(n).padStart(2, '0')).join('')
    + '-' + [d.getHours(), d.getMinutes()].map(n => String(n).padStart(2, '0')).join('');
  const file = path.join('reports', `paper-run-${stamp}.md`);
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(file, md);
  console.log(md);
  console.log(`\nSaved to ${file}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
