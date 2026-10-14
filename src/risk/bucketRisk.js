// BucketRisk — limits owned by a single bucket, plus per-bucket pause.
import { E } from '../shared/errors.js';
import { createLogger } from '../shared/logger.js';

const DAY = 24 * 60 * 60 * 1000;

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

  // Returns { ok, code?, reason? }.
  checkEntry(bucketId, notionalUsd, { bucketEquityUsd, allocatedUsd }) {
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
