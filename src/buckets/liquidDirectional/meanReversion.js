// Mean reversion, ported from trading-bot. Used in RANGING.
// Buys at or near the lower Bollinger band with low RSI; targets the middle band.
// SELL means "exit": price at or near the upper band with high RSI.
import { bollingerBands, bollingerPercentB, rsi } from '../../analysis/indicators.js';

export function meanReversion({ closes }, params) {
  const price = closes.at(-1);
  const bb = bollingerBands(closes, params.bollingerPeriod, params.bollingerStdDev);
  const pctB = bollingerPercentB(price, bb);
  const r = rsi(closes, params.rsiPeriod);

  if (!bb || pctB == null || r == null) {
    return { direction: 'HOLD', confidence: 0, reason: 'indicators not ready' };
  }

  const reasons = [];
  let buy = 0, sell = 0;

  if (pctB <= 0)        { buy += 0.55; reasons.push(`below lower BB (%B ${(pctB * 100).toFixed(1)})`); }
  else if (pctB < 0.20) { buy += 0.30; reasons.push(`near lower BB (%B ${(pctB * 100).toFixed(1)})`); }

  if (r < params.rsiOversold) { buy += 0.35; reasons.push(`RSI oversold ${r.toFixed(1)}`); }
  else if (r < 40)            { buy += 0.15; }

  if (pctB >= 1)        { sell += 0.55; reasons.push(`above upper BB (%B ${(pctB * 100).toFixed(1)})`); }
  else if (pctB > 0.80) { sell += 0.30; reasons.push(`near upper BB (%B ${(pctB * 100).toFixed(1)})`); }

  if (r > params.rsiOverbought) { sell += 0.35; reasons.push(`RSI overbought ${r.toFixed(1)}`); }
  else if (r > 60)              { sell += 0.15; }

  let direction = 'HOLD', confidence = 0;
  if (buy >= 0.50 && buy > sell)       { direction = 'BUY';  confidence = Math.min(buy, 1); }
  else if (sell >= 0.50 && sell > buy) { direction = 'SELL'; confidence = Math.min(sell, 1); }

  return {
    direction,
    confidence,
    reason:      reasons.join(' | '),
    targetPrice: bb.middle,
    stopLoss:    bb.lower * 0.99,
  };
}
