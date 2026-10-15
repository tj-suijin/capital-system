// BucketRisk — limits owned by a single bucket, plus per-bucket pause.
//
// Optional entry rules (off when absent from the bucket's risk config):
//   cooldownAfterStopMs — no entry this soon after a position closed at its stop
//   minEntrySpacingMs   — no entry this soon after the last entry on the same side
//   noEntryWhileLosing  — no entry while an open position is under water at its mark
import { STOP_LOSS_EXIT } from '../buckets/intent.js';
import { E } from '../shared/errors.js';
import { createLogger } from '../shared/logger.js';

const DAY = 24 * 60 * 60 * 1000;
const mins = ms => `${Math.ceil(ms / 60_000)}m`;

export class BucketRisk {
  constructor({ store, config, clock = Date.now }) {
    this.store  = store;
    this.config = config;
    this.clock  = clock;
    this.log    = createLogger('BUCKET_RISK');
  }

  limits(bucketId) {
    return this.config.buckets[bucketId].risk;
  }

  // Returns { ok, code?, reason? }. openPositions are marked (see valuation.js).
  checkEntry(bucketId, notionalUsd, { bucketEquityUsd, allocatedUsd, side = 'BUY', openPositions = [] }) {
    const lim = this.limits(bucketId);

    const paused = this.pauseState(bucketId);
    if (paused.paused) return this._block(E.BUCKET_PAUSED, paused.reason || 'operator pause');

    const open = this.store.getOpenPositions(bucketId).length;
    if (open >= lim.maxConcurrentPositions) {
      return this._block(E.BUCKET_MAX_POS, `${open}/${lim.maxConcurrentPositions} open`);
    }

    const maxSize = bucketEquityUsd * lim.maxPositionPctOfBucket;
    if (notionalUsd > maxSize + 1e-9) {
      return this._block(E.BUCKET_MAX_SIZE, `$${notionalUsd.toFixed(2)} > $${maxSize.toFixed(2)}`);
    }

    const daily = this.store.realizedPnlSince(this.clock() - DAY, bucketId);
    const limitUsd = allocatedUsd * lim.dailyLossLimitPct;
    if (daily < 0 && -daily >= limitUsd) {
      return this._block(E.BUCKET_DAILY_LOSS, `24h P&L $${daily.toFixed(2)}, limit $${limitUsd.toFixed(2)}`);
    }

    const now = this.clock();
    if (lim.cooldownAfterStopMs > 0) {
      const at = this.store.lastExitAt(bucketId, STOP_LOSS_EXIT);
      if (at != null && now - at < lim.cooldownAfterStopMs) {
        return this._block(E.BUCKET_COOLDOWN, `stopped out ${mins(now - at)} ago, entries resume in ${mins(at + lim.cooldownAfterStopMs - now)}`);
      }
    }
    if (lim.minEntrySpacingMs > 0) {
      const at = this.store.lastEntryAt(bucketId, side);
      if (at != null && now - at < lim.minEntrySpacingMs) {
        return this._block(E.BUCKET_SPACING, `last ${side} ${mins(now - at)} ago, minimum ${mins(lim.minEntrySpacingMs)}`);
      }
    }
    if (lim.noEntryWhileLosing) {
      const losing = openPositions.filter(p => p.priced && p.unrealizedPnlUsd < 0);
      if (losing.length) {
        return this._block(E.BUCKET_LOSING, losing.map(p => `#${p.id} at -$${(-p.unrealizedPnlUsd).toFixed(2)}`).join(', '));
      }
    }
    return { ok: true };
  }

  pause(bucketId, reason = 'operator pause') {
    this.store.setRiskState(this._key(bucketId), { paused: true, reason }, this.clock());
    this.log.warn({ bucket: bucketId, reason }, 'Bucket paused');
  }

  resume(bucketId) {
    this.store.setRiskState(this._key(bucketId), { paused: false, reason: null }, this.clock());
    this.log.info({ bucket: bucketId }, 'Bucket resumed');
  }

  pauseState(bucketId) {
    return this.store.getRiskState(this._key(bucketId)) ?? { paused: false, reason: null };
  }

  _key(bucketId) {
    return `bucket:${bucketId}`;
  }

  _block(def, detail) {
    return { ok: false, code: def.code, reason: `${def.msg}: ${detail}` };
  }
}

export default BucketRisk;
