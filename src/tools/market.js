// npm run market — run bucket 1's market data feed on its own and log the
// analyst's view at every closed entry candle. Nothing is traded.
import * as ethers from 'ethers';
import { CONFIG } from '../../config/portfolio.js';
import { analyze } from '../buckets/liquidDirectional/analyst.js';
import { MarketData } from '../data/marketData.js';
import { getStore } from '../persistence/db.js';
import { LOCK_HELD_EXIT_CODE, acquireLock, lockPathFor } from '../shared/instanceLock.js';
import { createLogger } from '../shared/logger.js';

const log = createLogger('MARKET_CLI');
const bucket = CONFIG.buckets.majorsTrader;
const params = bucket.strategy;

// It writes candles to the same database, so it cannot run beside `npm start`.
const lock = acquireLock(lockPathFor(CONFIG.db.path));
if (!lock.ok) {
  log.error({ ownerPid: lock.pid, lock: lock.path }, 'The capital system (or another market tool) is running against this database — not starting');
  setTimeout(() => process.exit(LOCK_HELD_EXIT_CODE), 250);
  await new Promise(() => {});
}
process.on('exit', () => lock.release());

const store  = getStore();
const market = new MarketData({ ethers, store, market: bucket.market, chain: CONFIG.chain });

function report() {
  const view = analyze({
    regimeCandles: market.getCandles(params.regime.timeframe, params.regime.minCandles + 10),
    entryCandles:  market.getCandles(params.entry.timeframe, params.entry.minCandles + 40),
  }, params);
  log.info({
    price:      market.lastPrice && +market.lastPrice.toFixed(2),
    regime:     view.regime.regime,
    regimeConf: +view.regime.confidence.toFixed(2),
    entry:      view.entry,
    noTrade:    view.noTradeReason,
    exits:      view.exits,
  }, 'Analyst view');
}

market.on('candle', ({ timeframe }) => { if (timeframe === params.entry.timeframe) report(); });

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await market.stop();
  store.close();
  setTimeout(() => process.exit(0), 250);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await market.start();
  report();
} catch (err) {
  log.fatal({ code: err.code, err: err.message }, 'Market data failed to start');
  setTimeout(() => process.exit(1), 250);
}
