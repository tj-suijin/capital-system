// Execution adapter interface. One adapter per venue/chain (Uniswap on Base,
// a Solana venue for the degen bucket, ...). The portfolio manager is the
// only caller.
//
// open({ bucketId, symbol, side, price, notionalUsd, volatilityPct })
//   → { fillPrice, qty, feeUsd, venue }
// close({ position, price, volatilityPct })
//   → { fillPrice, proceedsUsd, feeUsd }
//
// volatilityPct is the bucket's recent price range (or null); only the paper
// executor uses it, to model slippage.

export class ExecutionAdapter {
  constructor({ venue, isLive }) {
    this.venue  = venue;
    this.isLive = isLive;
  }

  async open(_order) {
    throw new Error(`${this.constructor.name}.open() not implemented`);
  }

  async close(_req) {
    throw new Error(`${this.constructor.name}.close() not implemented`);
  }
}

export default ExecutionAdapter;
