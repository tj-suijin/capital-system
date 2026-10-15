// PaperExecutor — venue-agnostic simulated fills at a supplied price.
// Buys fill at price × (1 + slippage), sells at price × (1 − slippage);
// a fee of feePct is charged on notional at both open and close.
//
// slippage = slippagePct + rangeSlippageShare × volatilityPct, where
// volatilityPct is the bucket's recent high-low range. In a fast market the
// price moves before a real swap lands, so fills get worse with volatility.
import { ExecutionAdapter } from './adapter.js';

export class PaperExecutor extends ExecutionAdapter {
  constructor({ feePct, slippagePct, rangeSlippageShare = 0 }) {
    super({ venue: 'paper', isLive: false });
    this.feePct             = feePct;
    this.slippagePct        = slippagePct;
    this.rangeSlippageShare = rangeSlippageShare;
  }

  slippage(volatilityPct) {
    return this.slippagePct + this.rangeSlippageShare * Math.max(0, volatilityPct ?? 0);
  }

  async open({ price, notionalUsd, volatilityPct = null }) {
    const fillPrice = price * (1 + this.slippage(volatilityPct));
    return {
      fillPrice,
      qty:    notionalUsd / fillPrice,
      feeUsd: notionalUsd * this.feePct,
      venue:  this.venue,
    };
  }

  async close({ position, price, volatilityPct = null }) {
    const fillPrice   = price * (1 - this.slippage(volatilityPct));
    const proceedsUsd = position.qty * fillPrice;
    return {
      fillPrice,
      proceedsUsd,
      feeUsd: proceedsUsd * this.feePct,
    };
  }
}

export default PaperExecutor;
