// Analyst — combines regime detection with the strategy that suits it.
// Pure: candles in, a view out. The bucket turns the view into intents.
//
//   TRENDING_UP   → trend following
//   RANGING       → mean reversion
//   TRENDING_DOWN → no entries (long-only)
//   UNCERTAIN     → no entries
//
// Entry confidence = strategy confidence × regime confidence (as in trading-bot).
// Exit signals are computed for both strategies on every call, whatever the
// regime, so open positions can be closed by the strategy that opened them.
import { meanReversion } from './meanReversion.js';
import { REGIME, detectRegime } from './regimeDetector.js';
import { trendFollowing } from './trendFollowing.js';

export const STRATEGY = {
  TREND:          'trend_following',
  MEAN_REVERSION: 'mean_reversion',
};

const series = candles => ({
  closes: candles.map(c => c.close),
  highs:  candles.map(c => c.high),
  lows:   candles.map(c => c.low),
});

export function analyze({ regimeCandles, entryCandles }, params) {
  const regime = detectRegime(series(regimeCandles), params.regime);
  const view = { regime, entry: null, noTradeReason: null, exits: {}, signals: {} };

  if (entryCandles.length < params.entry.minCandles) {
    view.noTradeReason = `entry candles warming up (${entryCandles.length}/${params.entry.minCandles})`;
    return view;
  }

  const e = series(entryCandles);
  const price = e.closes.at(-1);
  const tf = trendFollowing(e, params.trendFollowing);
  const mr = meanReversion(e, params.meanReversion);
  view.signals = { [STRATEGY.TREND]: tf, [STRATEGY.MEAN_REVERSION]: mr };
  if (tf.direction === 'SELL') view.exits[STRATEGY.TREND] = tf.reason;
  if (mr.direction === 'SELL') view.exits[STRATEGY.MEAN_REVERSION] = mr.reason;

  let strategy, sig;
  switch (regime.regime) {
    case REGIME.TRENDING_UP: strategy = STRATEGY.TREND;          sig = tf; break;
    case REGIME.RANGING:     strategy = STRATEGY.MEAN_REVERSION; sig = mr; break;
    case REGIME.TRENDING_DOWN:
      view.noTradeReason = 'downtrend — long-only, no entries';
      return view;
    default:
      view.noTradeReason = `regime uncertain (${regime.reason})`;
      return view;
  }

  if (sig.direction !== 'BUY') {
    view.noTradeReason = `${strategy}: ${sig.direction === 'SELL' ? 'exit signal' : 'no setup'}${sig.reason ? ` (${sig.reason})` : ''}`;
    return view;
  }

  const confidence = sig.confidence * regime.confidence;
  if (confidence < params.minConfidence) {
    view.noTradeReason = `${strategy}: confidence ${(confidence * 100).toFixed(0)}% below ${(params.minConfidence * 100).toFixed(0)}%`;
    return view;
  }

  view.entry = {
    strategy,
    confidence,
    price,
    stopLoss:    sig.stopLoss ?? null,
    targetPrice: sig.targetPrice ?? null,
    reason:      `[${regime.regime}] ${sig.reason}`,
  };
  return view;
}
