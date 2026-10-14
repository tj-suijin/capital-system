// PaperExecutor — venue-agnostic simulated fills at a supplied price.
// Buys fill at price × (1 + slippage), sells at price × (1 − slippage);
// a fee of feePct is charged on notional at both open and close.
import { ExecutionAdapter } from './adapter.js';

export class PaperExecutor extends ExecutionAdapter {
  constructor({ feePct, slippagePct }) {
    super({ venue: 'paper', isLive: false });
    this.feePct      = feePct;
    this.slippagePct = slippagePct;
  }

  async open({ price, notionalUsd }) {
    const fillPrice = price * (1 + this.slippagePct);
    return {
      fillPrice,
      qty:    notionalUsd / fillPrice,
      feeUsd: notionalUsd * this.feePct,
      venue:  this.venue,
    };
  }

  async close({ position, price }) {
    const fillPrice   = price * (1 - this.slippagePct);
    const proceedsUsd = position.qty * fillPrice;
    return {
      fillPrice,
      proceedsUsd,
      feeUsd: proceedsUsd * this.feePct,
    };
  }
}

export default PaperExecutor;
