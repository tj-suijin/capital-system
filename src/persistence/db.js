// SQLite persistence via Node's built-in node:sqlite (no native build step).
// All timestamps are epoch milliseconds supplied by the caller's clock.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CONFIG } from '../../config/portfolio.js';

let _store = null;

export function getStore(dbPath = CONFIG.db.path) {
  if (!_store) _store = new Store(dbPath);
  return _store;
}

export function openStore(dbPath = ':memory:') {
  return new Store(dbPath);
}

export class Store {
  constructor(dbPath) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this._migrate();
  }

  close() {
    this.db.close();
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS buckets (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        mode       TEXT NOT NULL,
        enabled    INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ledger (
        bucket_id        TEXT PRIMARY KEY,
        allocated_usd    REAL NOT NULL,
        cash_usd         REAL NOT NULL,
        in_use_usd       REAL NOT NULL DEFAULT 0,
        realized_pnl_usd REAL NOT NULL DEFAULT 0,
        updated_at       INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS positions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        bucket_id     TEXT    NOT NULL,
        symbol        TEXT    NOT NULL,
        side          TEXT    NOT NULL,
        mode          TEXT    NOT NULL,
        venue         TEXT    NOT NULL,
        entry_price   REAL    NOT NULL,
        qty           REAL    NOT NULL,
        notional_usd  REAL    NOT NULL,
        open_fee_usd  REAL    NOT NULL DEFAULT 0,
        stop_loss     REAL,
        take_profit   REAL,
        intent_reason TEXT,
        tag           TEXT,
        status        TEXT    NOT NULL DEFAULT 'open',
        opened_at     INTEGER NOT NULL,
        exit_price    REAL,
        close_fee_usd REAL,
        pnl_usd       REAL,
        exit_reason   TEXT,
        closed_at     INTEGER
      );

      CREATE TABLE IF NOT EXISTS trades (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id  INTEGER NOT NULL REFERENCES positions(id),
        bucket_id    TEXT    NOT NULL,
        action       TEXT    NOT NULL,
        price        REAL    NOT NULL,
        qty          REAL    NOT NULL,
        notional_usd REAL    NOT NULL,
        fee_usd      REAL    NOT NULL,
        mode         TEXT    NOT NULL,
        ts           INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        bucket_id   TEXT    NOT NULL,
        outcome     TEXT    NOT NULL,
        stage       TEXT    NOT NULL,
        code        TEXT,
        reason      TEXT,
        intent_json TEXT,
        ts          INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS risk_state (
        key        TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS equity_snapshots (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        bucket_id          TEXT    NOT NULL,
        equity_usd         REAL    NOT NULL,
        cash_usd           REAL    NOT NULL,
        in_use_usd         REAL    NOT NULL,
        realized_pnl_usd   REAL    NOT NULL,
        unrealized_pnl_usd REAL    NOT NULL DEFAULT 0,
        ts                 INTEGER NOT NULL
      );

      -- swaps = 0 marks a forward-filled candle (no trades in that interval).
      CREATE TABLE IF NOT EXISTS candles (
        pool         TEXT    NOT NULL,
        timeframe    TEXT    NOT NULL,
        ts           INTEGER NOT NULL,
        open         REAL    NOT NULL,
        high         REAL    NOT NULL,
        low          REAL    NOT NULL,
        close        REAL    NOT NULL,
        volume_quote REAL    NOT NULL DEFAULT 0,
        swaps        INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (pool, timeframe, ts)
      );

      -- Process starts and stops, data outages, error bursts, halts and operator actions.
      CREATE TABLE IF NOT EXISTS system_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        type        TEXT    NOT NULL,
        bucket_id   TEXT,
        detail_json TEXT,
        ts          INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_positions_bucket_status ON positions (bucket_id, status);
      CREATE INDEX IF NOT EXISTS idx_positions_opened_at     ON positions (opened_at);
      CREATE INDEX IF NOT EXISTS idx_decisions_ts            ON decisions (ts);
      CREATE INDEX IF NOT EXISTS idx_system_events_ts        ON system_events (ts);
      CREATE INDEX IF NOT EXISTS idx_positions_closed_at     ON positions (closed_at);
      CREATE INDEX IF NOT EXISTS idx_decisions_bucket_ts     ON decisions (bucket_id, ts);
      CREATE INDEX IF NOT EXISTS idx_equity_bucket_ts        ON equity_snapshots (bucket_id, ts);
    `);
    this._addColumn('positions', 'tag', 'TEXT');
    this._addColumn('equity_snapshots', 'unrealized_pnl_usd', 'REAL NOT NULL DEFAULT 0');
  }

  // For databases created before a column existed.
  _addColumn(table, column, type) {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some(c => c.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }

  // ---- Buckets ----
  upsertBucket({ id, name, mode, enabled }, ts) {
    this.db.prepare(`
      INSERT INTO buckets (id, name, mode, enabled, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, mode=excluded.mode,
        enabled=excluded.enabled, updated_at=excluded.updated_at
    `).run(id, name, mode, enabled ? 1 : 0, ts);
  }

  // ---- Ledger ----
  getLedger(bucketId) {
    return this.db.prepare('SELECT * FROM ledger WHERE bucket_id = ?').get(bucketId) ?? null;
  }

  getAllLedgers() {
    return this.db.prepare('SELECT * FROM ledger ORDER BY bucket_id').all();
  }

  saveLedger(row, ts) {
    this.db.prepare(`
      INSERT INTO ledger (bucket_id, allocated_usd, cash_usd, in_use_usd, realized_pnl_usd, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(bucket_id) DO UPDATE SET allocated_usd=excluded.allocated_usd,
        cash_usd=excluded.cash_usd, in_use_usd=excluded.in_use_usd,
        realized_pnl_usd=excluded.realized_pnl_usd, updated_at=excluded.updated_at
    `).run(row.bucket_id, row.allocated_usd, row.cash_usd, row.in_use_usd, row.realized_pnl_usd, ts);
  }

  // ---- Positions & trades ----
  insertPosition(p) {
    const r = this.db.prepare(`
      INSERT INTO positions (bucket_id, symbol, side, mode, venue, entry_price, qty, notional_usd,
        open_fee_usd, stop_loss, take_profit, intent_reason, tag, opened_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      p.bucketId, p.symbol, p.side, p.mode, p.venue, p.entryPrice, p.qty, p.notionalUsd,
      p.openFeeUsd, p.stopLoss ?? null, p.takeProfit ?? null, p.reason ?? null, p.tag ?? null, p.openedAt,
    );
    return Number(r.lastInsertRowid);
  }

  closePosition(id, { exitPrice, closeFeeUsd, pnlUsd, exitReason, closedAt }) {
    this.db.prepare(`
      UPDATE positions SET status='closed', exit_price=?, close_fee_usd=?, pnl_usd=?,
        exit_reason=?, closed_at=? WHERE id=? AND status='open'
    `).run(exitPrice, closeFeeUsd, pnlUsd, exitReason, closedAt, id);
  }

  getPosition(id) {
    return this.db.prepare('SELECT * FROM positions WHERE id = ?').get(id) ?? null;
  }

  getOpenPositions(bucketId = null) {
    if (bucketId) {
      return this.db.prepare("SELECT * FROM positions WHERE status='open' AND bucket_id=? ORDER BY opened_at").all(bucketId);
    }
    return this.db.prepare("SELECT * FROM positions WHERE status='open' ORDER BY opened_at").all();
  }

  positionsOpenedBetween(sinceMs, untilMs) {
    return this.db.prepare('SELECT * FROM positions WHERE opened_at >= ? AND opened_at < ? ORDER BY opened_at').all(sinceMs, untilMs);
  }

  positionsClosedBetween(sinceMs, untilMs) {
    return this.db.prepare("SELECT * FROM positions WHERE status='closed' AND closed_at >= ? AND closed_at < ? ORDER BY closed_at").all(sinceMs, untilMs);
  }

  insertTrade(t) {
    this.db.prepare(`
      INSERT INTO trades (position_id, bucket_id, action, price, qty, notional_usd, fee_usd, mode, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(t.positionId, t.bucketId, t.action, t.price, t.qty, t.notionalUsd, t.feeUsd, t.mode, t.ts);
  }

  getRecentTrades(limit = 20, bucketId = null) {
    if (bucketId) {
      return this.db.prepare('SELECT * FROM trades WHERE bucket_id=? ORDER BY ts DESC, id DESC LIMIT ?').all(bucketId, limit);
    }
    return this.db.prepare('SELECT * FROM trades ORDER BY ts DESC, id DESC LIMIT ?').all(limit);
  }

  // Sum of realized P&L on positions closed at or after sinceMs.
  realizedPnlSince(sinceMs, bucketId = null) {
    const row = bucketId
      ? this.db.prepare("SELECT COALESCE(SUM(pnl_usd),0) AS pnl FROM positions WHERE status='closed' AND closed_at >= ? AND bucket_id = ?").get(sinceMs, bucketId)
      : this.db.prepare("SELECT COALESCE(SUM(pnl_usd),0) AS pnl FROM positions WHERE status='closed' AND closed_at >= ?").get(sinceMs);
    return row.pnl;
  }

  // ---- Decisions ----
  insertDecision(d) {
    const r = this.db.prepare(`
      INSERT INTO decisions (bucket_id, outcome, stage, code, reason, intent_json, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(d.bucketId, d.outcome, d.stage, d.code ?? null, d.reason ?? null,
      d.intent ? JSON.stringify(d.intent) : null, d.ts);
    return Number(r.lastInsertRowid);
  }

  getRecentDecisions(limit = 20, bucketId = null) {
    const rows = bucketId
      ? this.db.prepare('SELECT * FROM decisions WHERE bucket_id=? ORDER BY ts DESC, id DESC LIMIT ?').all(bucketId, limit)
      : this.db.prepare('SELECT * FROM decisions ORDER BY ts DESC, id DESC LIMIT ?').all(limit);
    return rows.map(r => ({ ...r, intent: r.intent_json ? JSON.parse(r.intent_json) : null }));
  }

  // Grouped by bucket, outcome, stage, code and exact reason, for summaries.
  decisionGroupsBetween(sinceMs, untilMs) {
    return this.db.prepare(`
      SELECT bucket_id, outcome, stage, code, reason, COUNT(*) AS n
      FROM decisions WHERE ts >= ? AND ts < ?
      GROUP BY bucket_id, outcome, stage, code, reason
    `).all(sinceMs, untilMs);
  }

  decisionCountsSince(sinceMs, bucketId = null) {
    const rows = bucketId
      ? this.db.prepare('SELECT outcome, COUNT(*) AS n FROM decisions WHERE ts >= ? AND bucket_id = ? GROUP BY outcome').all(sinceMs, bucketId)
      : this.db.prepare('SELECT outcome, COUNT(*) AS n FROM decisions WHERE ts >= ? GROUP BY outcome').all(sinceMs);
    return Object.fromEntries(rows.map(r => [r.outcome, r.n]));
  }

  // ---- Risk state ----
  getRiskState(key) {
    const row = this.db.prepare('SELECT value_json FROM risk_state WHERE key = ?').get(key);
    return row ? JSON.parse(row.value_json) : null;
  }

  setRiskState(key, value, ts) {
    this.db.prepare(`
      INSERT INTO risk_state (key, value_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
    `).run(key, JSON.stringify(value), ts);
  }

  // ---- Settings ----
  getSetting(key) {
    return this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
  }

  setSetting(key, value, ts) {
    this.db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `).run(key, String(value), ts);
  }

  // ---- Equity snapshots ----
  insertEquitySnapshot(s) {
    this.db.prepare(`
      INSERT INTO equity_snapshots (bucket_id, equity_usd, cash_usd, in_use_usd, realized_pnl_usd, unrealized_pnl_usd, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(s.bucketId, s.equityUsd, s.cashUsd, s.inUseUsd, s.realizedPnlUsd, s.unrealizedPnlUsd ?? 0, s.ts);
  }

  equitySnapshotsBetween(bucketId, sinceMs, untilMs) {
    return this.db.prepare('SELECT * FROM equity_snapshots WHERE bucket_id = ? AND ts >= ? AND ts < ? ORDER BY ts').all(bucketId, sinceMs, untilMs);
  }

  // ---- System events ----
  insertEvent({ type, bucketId = null, detail = null, ts }) {
    this.db.prepare('INSERT INTO system_events (type, bucket_id, detail_json, ts) VALUES (?, ?, ?, ?)')
      .run(type, bucketId, detail ? JSON.stringify(detail) : null, ts);
  }

  eventsBetween(sinceMs, untilMs) {
    return this.db.prepare('SELECT * FROM system_events WHERE ts >= ? AND ts < ? ORDER BY ts, id').all(sinceMs, untilMs)
      .map(r => ({ ...r, detail: r.detail_json ? JSON.parse(r.detail_json) : null }));
  }

  getEquityHistory(bucketId, sinceMs = 0, limit = 2000) {
    return this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM equity_snapshots WHERE bucket_id = ? AND ts >= ? ORDER BY ts DESC LIMIT ?
      ) ORDER BY ts ASC
    `).all(bucketId, sinceMs, limit);
  }

  // ---- Candles ----
  upsertCandle(c) {
    this.db.prepare(`
      INSERT INTO candles (pool, timeframe, ts, open, high, low, close, volume_quote, swaps)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pool, timeframe, ts) DO UPDATE SET open=excluded.open, high=excluded.high,
        low=excluded.low, close=excluded.close, volume_quote=excluded.volume_quote, swaps=excluded.swaps
    `).run(c.pool, c.timeframe, c.ts, c.open, c.high, c.low, c.close, c.volumeQuote ?? 0, c.swaps ?? 0);
  }

  // The most recent `limit` candles, oldest first.
  getCandles(pool, timeframe, limit = 500) {
    return this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM candles WHERE pool = ? AND timeframe = ? ORDER BY ts DESC LIMIT ?
      ) ORDER BY ts ASC
    `).all(pool, timeframe, limit);
  }

  getFirstCandleFrom(pool, timeframe, fromTs) {
    return this.db.prepare(
      'SELECT * FROM candles WHERE pool = ? AND timeframe = ? AND ts >= ? ORDER BY ts ASC LIMIT 1',
    ).get(pool, timeframe, fromTs) ?? null;
  }

  getLastCandle(pool, timeframe, beforeTs = Number.MAX_SAFE_INTEGER) {
    return this.db.prepare(
      'SELECT * FROM candles WHERE pool = ? AND timeframe = ? AND ts < ? ORDER BY ts DESC LIMIT 1',
    ).get(pool, timeframe, beforeTs) ?? null;
  }
}

export default getStore;
