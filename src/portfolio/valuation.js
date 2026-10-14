// Mark-to-market valuation of open positions (long-only spot).
//
//   valueUsd         = qty × mark price, or the notional at cost when no price exists
//   unrealizedPnlUsd = valueUsd − notional − open fee
//
// Marks are mid prices: estimated exit costs (close fee, slippage) are not
// deducted, so a position's realized P&L will come in slightly below its last mark.

// mark: { price, ts } or null.
export function markPosition(position, mark, now) {
  const priced   = mark != null && Number.isFinite(mark.price) && mark.price > 0;
  const valueUsd = priced ? position.qty * mark.price : position.notional_usd;
  return {
    ...position,
    priced,
    markPrice:        priced ? mark.price : null,
    markTs:           priced ? mark.ts ?? null : null,
    markAgeMs:        priced && mark.ts != null ? Math.max(0, now - mark.ts) : null,
    heldMs:           Math.max(0, now - position.opened_at),
    valueUsd,
    unrealizedPnlUsd: valueUsd - position.notional_usd - (position.open_fee_usd ?? 0),
  };
}

export function sumMarks(marked) {
  return marked.reduce((s, p) => ({
    valueUsd:         s.valueUsd + p.valueUsd,
    notionalUsd:      s.notionalUsd + p.notional_usd,
    unrealizedPnlUsd: s.unrealizedPnlUsd + p.unrealizedPnlUsd,
  }), { valueUsd: 0, notionalUsd: 0, unrealizedPnlUsd: 0 });
}
