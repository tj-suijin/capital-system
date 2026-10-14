// Placeholder for a real on-chain adapter. It refuses to trade.
import { ExecutionAdapter } from './adapter.js';
import { E, TradingError } from '../shared/errors.js';

export class LiveExecutorStub extends ExecutionAdapter {
  constructor(venue = 'unimplemented') {
    super({ venue, isLive: true });
  }

  async open() {
    throw new TradingError(E.EXEC_NOT_IMPL, this.venue);
  }

  async close() {
    throw new TradingError(E.EXEC_NOT_IMPL, this.venue);
  }
}

export default LiveExecutorStub;
