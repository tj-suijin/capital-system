// Position sizing, ported from trading-bot and made bucket-relative.
//
//   base   = bucketEquity × maxPositionPctOfBucket × confidence
//   capped by the bucket's requested size (if any)
//   capped so that (size × stopLossPct) ≤ bucketEquity × maxRiskPerTradePct
//   capped by the bucket's free cash

export function sizePosition({
  bucketEquityUsd,
  availableCashUsd,
  maxPositionPctOfBucket,
  maxRiskPerTradePct,
  confidence = 1,
  stopLossPct = null,
  requestedUsd = null,
}) {
  const conf = Math.min(1, Math.max(0, confidence));
  let size = bucketEquityUsd * maxPositionPctOfBucket * conf;

  if (requestedUsd != null) size = Math.min(size, requestedUsd);

  if (stopLossPct != null && stopLossPct > 0) {
    size = Math.min(size, (bucketEquityUsd * maxRiskPerTradePct) / stopLossPct);
  }

  size = Math.min(size, availableCashUsd);
  return size > 0 ? size : 0;
}

export default sizePosition;
