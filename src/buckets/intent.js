// The only two answers a bucket may give from evaluate():
//   noTrade(reason)       — a normal, expected outcome
//   tradeIntent({...})    — a request; the portfolio manager decides size and approval
//
// Step 1 supports spot longs only (side 'BUY').

export const NO_TRADE = 'NO_TRADE';
export const TRADE    = 'TRADE';

export function noTrade(reason) {
  return { type: NO_TRADE, reason: String(reason ?? 'no setup') };
}

export function tradeIntent({ symbol, side = 'BUY', price, confidence = 1, stopLossPct = null, takeProfitPct = null, requestedUsd = null, reason }) {
  if (!symbol) throw new Error('tradeIntent: symbol required');
  if (side !== 'BUY') throw new Error(`tradeIntent: unsupported side ${side} (step 1 is long-only)`);
  if (!(price > 0)) throw new Error('tradeIntent: price must be > 0');
  if (!(confidence >= 0 && confidence <= 1)) throw new Error('tradeIntent: confidence must be in [0,1]');
  if (stopLossPct != null && !(stopLossPct > 0 && stopLossPct < 1)) throw new Error('tradeIntent: stopLossPct must be in (0,1)');
  if (!reason) throw new Error('tradeIntent: reason required');
  return { type: TRADE, symbol, side, price, confidence, stopLossPct, takeProfitPct, requestedUsd, reason };
}

// From reviewPositions(): ask the portfolio manager to close an open position.
export function closeRequest({ positionId, price, reason }) {
  if (!(price > 0)) throw new Error('closeRequest: price must be > 0');
  return { positionId, price, reason: String(reason ?? 'bucket exit') };
}
