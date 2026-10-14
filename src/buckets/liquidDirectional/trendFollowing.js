// Trend following, ported from trading-bot. Used in TRENDING_UP.
// Buys pullbacks to the fast EMA confirmed by RSI, MACD and the slow EMA.
// SELL means "exit": price crossed below the fast EMA, or the score turned negative.
import { ema, macd, recentSwingLow, rsi } from '../../analysis/indicators.js';

export function trendFollowing({ closes, lows }, params) {
  const price = closes.at(-1);
  const prev  = closes.at(-2);
  const emaFast = ema(closes, params.emaFast);
  const emaSlow = ema(closes, params.emaSlow);
  const r = rsi(closes, params.rsiPeriod);
  const m = macd(closes);

  if (emaFast == null || emaSlow == null || r == null) {
    return { direction: 'HOLD', confidence: 0, reason: 'indicators not ready' };
  }

  if (prev > emaFast && price < emaFast) {
    return { direction: 'SELL', confidence: 0.80, reason: `price crossed below EMA${params.emaFast}` };
  }

  let buy = 0, sell = 0;
  const reasons = [];

  const dist = (price - emaFast) / emaFast;
  if (Math.abs(dist) <= params.emaPullbackBuffer) { buy += 30; reasons.push(`at EMA${params.emaFast} (${(dist * 100).toFixed(2)}%)`); }
  else if (dist > 0 && dist < 0.02)               { buy += 10; }
  else if (dist < 0)                              { sell += 15; }

  if (r >= params.rsiMin && r <= params.rsiMax) { buy += 30; reasons.push(`RSI ${r.toFixed(1)}`); }
  else if (r < params.rsiMin)                   { buy += 10; reasons.push(`RSI low ${r.toFixed(1)}`); }
  else                                          { sell += 25; reasons.push(`RSI overbought ${r.toFixed(1)}`); }

  if (m?.histogram > 0)       { buy += 20; reasons.push('MACD positive'); }
  else if (m?.histogram < 0)  { sell += 15; }

  if (price > emaSlow) { buy += 20; reasons.push(`above EMA${params.emaSlow}`); }
  else                 { sell += 20; reasons.push(`below EMA${params.emaSlow}`); }

  const net = (buy - sell) / ((buy + sell) || 1);
  return {
    direction:   net > 0.25 ? 'BUY' : net < -0.25 ? 'SELL' : 'HOLD',
    confidence:  Math.abs(net),
    reason:      reasons.join(' | '),
    stopLoss:    recentSwingLow(lows, params.swingLookback),
    targetPrice: null,
  };
}
