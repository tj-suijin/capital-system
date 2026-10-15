// CapitalAllocator — one persisted ledger per bucket plus an untouchable reserve.
//
// Ledger fields (USD):
//   allocated_usd    — the bucket's starting allocation
//   cash_usd         — free capital the bucket may still deploy
//   in_use_usd       — notional currently locked in open positions (at cost)
//   realized_pnl_usd — cumulative realized P&L (net of fees)
//
// Equity is cash + in_use + unrealized P&L of open positions. The ledger
// itself only moves on open and close; unrealized P&L comes from the
// injected `unrealized(bucketId)` (see valuation.js).
import { RESERVE_ID } from '../../config/portfolio.js';
import { E, TradingError } from '../shared/errors.js';
import { createLogger } from '../shared/logger.js';

const EPS = 1e-9;

export class CapitalAllocator {
  constructor({ store, config, clock = Date.now, unrealized = () => 0 }) {
    this.store      = store;
    this.config     = config;
    this.clock      = clock;
    this.unrealized = unrealized;
    this.log        = createLogger('ALLOCATOR');
  }

  // Creates ledgers on first run. Existing ledgers are kept as-is; changing
  // allocationPct in config later does NOT move capital (rebalancing is manual).
  init() {
    const total   = this.config.capital.totalUsd;
    const buckets = Object.entries(this.config.buckets).filter(([, b]) => b.enabled);
    const sumPct  = buckets.reduce((s, [, b]) => s + b.allocationPct, 0);

    if (sumPct > 1 + EPS) {
      throw new Error(`Bucket allocations sum to ${(sumPct * 100).toFixed(1)}% (> 100%)`);
    }
    for (const [id, b] of buckets) {
      if (id === RESERVE_ID) throw new Error(`"${RESERVE_ID}" is a reserved bucket id`);
      if (!(b.allocationPct >= 0)) throw new Error(`Invalid allocationPct for ${id}`);
    }

    const ts = this.clock();
    const wanted = [...buckets.map(([id, b]) => [id, total * b.allocationPct]), [RESERVE_ID, total * (1 - sumPct)]];

    // New ledgers next to existing ones (a renamed or newly added bucket)
    // would hand out capital that the existing ledgers already hold.
    const existing = this.store.getAllLedgers();
    const missing  = wanted.filter(([id]) => !existing.some(l => l.bucket_id === id));
    const heldUsd  = existing.reduce((s, l) => s + l.allocated_usd, 0);
    const addedUsd = missing.reduce((s, [, amount]) => s + amount, 0);
    if (existing.length && missing.length && heldUsd + addedUsd > total + 0.01) {
      throw new Error(
        `Database already allocates $${heldUsd.toFixed(2)} (${existing.map(l => l.bucket_id).join(', ')}); `
        + `adding ${missing.map(([id]) => id).join(', ')} would exceed the $${total.toFixed(2)} total. `
        + 'Archive the database and start fresh, or rebalance by hand.',
      );
    }

    for (const [id, amount] of wanted) {
      const existing = this.store.getLedger(id);
      if (!existing) {
        this.store.saveLedger({ bucket_id: id, allocated_usd: amount, cash_usd: amount, in_use_usd: 0, realized_pnl_usd: 0 }, ts);
        this.log.info({ bucket: id, allocatedUsd: amount }, 'Ledger created');
      } else if (Math.abs(existing.allocated_usd - amount) > 0.01) {
        this.log.warn({ bucket: id, ledgerUsd: existing.allocated_usd, configUsd: amount },
          'Config allocation differs from persisted ledger — keeping ledger (rebalance is manual)');
      }
    }
  }

  ledger(bucketId) {
    const row = this.store.getLedger(bucketId);
    if (!row) throw new TradingError(E.PM_UNKNOWN_BUCKET, bucketId);
    return row;
  }

  available(bucketId) {
    if (bucketId === RESERVE_ID) return 0;
    return this.ledger(bucketId).cash_usd;
  }

  equity(bucketId) {
    const l = this.ledger(bucketId);
    return l.cash_usd + l.in_use_usd + this.unrealized(bucketId);
  }

  totalEquity() {
    return this.store.getAllLedgers().reduce((s, l) => s + l.cash_usd + l.in_use_usd + this.unrealized(l.bucket_id), 0);
  }

  totalInUse() {
    return this.store.getAllLedgers().reduce((s, l) => s + l.in_use_usd, 0);
  }

  // Lock capital for a new position. Returns { ok, code?, reason? }.
  reserve(bucketId, amountUsd) {
    if (bucketId === RESERVE_ID) return { ok: false, ...this._why(E.CAPITAL_RESERVE) };
    if (!(amountUsd > 0)) return { ok: false, ...this._why(E.SIZE_ZERO) };

    const l = this.ledger(bucketId);
    if (amountUsd > l.cash_usd + EPS) {
      return { ok: false, ...this._why(E.CAPITAL_SHORT, `need $${amountUsd.toFixed(2)}, have $${l.cash_usd.toFixed(2)}`) };
    }
    l.cash_usd   -= amountUsd;
    l.in_use_usd += amountUsd;
    this.store.saveLedger(l, this.clock());
    return { ok: true };
  }

  // Unlock capital when a position closes. pnlUsd is net of all fees.
  release(bucketId, notionalUsd, pnlUsd = 0) {
    const l = this.ledger(bucketId);
    l.in_use_usd        = Math.max(0, l.in_use_usd - notionalUsd);
    l.cash_usd          = Math.max(0, l.cash_usd + notionalUsd + pnlUsd);
    l.realized_pnl_usd += pnlUsd;
    this.store.saveLedger(l, this.clock());
  }

  summary() {
    return this.store.getAllLedgers().map(l => {
      const unrealizedPnlUsd = this.unrealized(l.bucket_id);
      return {
        bucketId:       l.bucket_id,
        allocatedUsd:   l.allocated_usd,
        cashUsd:        l.cash_usd,
        inUseUsd:       l.in_use_usd,
        realizedPnlUsd: l.realized_pnl_usd,
        unrealizedPnlUsd,
        equityUsd:      l.cash_usd + l.in_use_usd + unrealizedPnlUsd,
      };
    });
  }

  _why(def, detail) {
    return { code: def.code, reason: detail ? `${def.msg}: ${detail}` : def.msg };
  }
}

export default CapitalAllocator;
