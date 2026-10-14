// Regime detection, ported from trading-bot.
// Scores TRENDING_UP / TRENDING_DOWN / RANGING from the EMA stack, ADX and
// Bollinger width; the winner's share of the total score is the confidence.
// Below params.minConfidence the regime is UNCERTAIN.
import { adx, bollingerBands, ema } from '../../analysis/indicators.js';

export const REGIME = {
  TRENDING_UP:   'TRENDING_UP',
  TRENDING_DOWN: 'TRENDING_DOWN',
  RANGING:       'RANGING',
  UNCERTAIN:     'UNCERTAIN',
};

export function detectRegime({ closes, highs, lows }, params) {
  if (!closes || closes.length < params.minCandles) {
    return { regime: REGIME.UNCERTAIN, confidence: 0, reason: `warming up (${closes?.length ?? 0}/${params.minCandles} candles)`, indicators: {} };
  }

  const scores = { TRENDING_UP: 0, TRENDING_DOWN: 0, RANGING: 0 };
  const reasons = [];
  const price = closes.at(-1);

  const emaFast = ema(closes, params.ema.fast);
  const emaSlow = ema(closes, params.ema.slow);
  const emaLong = ema(closes, params.ema.long);
  const indicators = { emaFast, emaSlow, emaLong };

  if (price > emaFast && emaFast > emaSlow && emaSlow > emaLong) {
    scores.TRENDING_UP += 40;
    reasons.push('EMA stack bullish');
  } else if (price < emaFast && emaFast < emaSlow && emaSlow < emaLong) {
    scores.TRENDING_DOWN += 40;
    reasons.push('EMA stack bearish');
  } else {
    scores.RANGING += 20;
    reasons.push('EMAs tangled');
  }

  const a = adx(highs, lows, closes, params.adx.period);
  if (a) {
    Object.assign(indicators, a);
    const up = a.plusDI > a.minusDI;
    if (a.adx > params.adx.trending) {
      scores[up ? 'TRENDING_UP' : 'TRENDING_DOWN'] += 30;
      reasons.push(`ADX ${a.adx.toFixed(1)} strong ${up ? 'bullish' : 'bearish'}`);
    } else if (a.adx < params.adx.weak) {
      scores.RANGING += 30;
      reasons.push(`ADX ${a.adx.toFixed(1)} weak`);
    } else {
      scores[up ? 'TRENDING_UP' : 'TRENDING_DOWN'] += 10;
      reasons.push(`ADX ${a.adx.toFixed(1)} moderate`);
    }
  }

  const bb = bollingerBands(closes, params.bb.period, params.bb.stdDev);
  if (bb) {
    indicators.bbWidth = bb.width;
    if (bb.width < params.bb.squeeze) {
      scores.RANGING += 20;
      reasons.push(`BB squeeze ${(bb.width * 100).toFixed(1)}%`);
    } else if (bb.width > params.bb.wide) {
      scores[price > bb.middle ? 'TRENDING_UP' : 'TRENDING_DOWN'] += 10;
      reasons.push(`BB wide ${(bb.width * 100).toFixed(1)}%`);
    }
  }

  const total = Object.values(scores).reduce((s, v) => s + v, 0) || 1;
  const [name, top] = Object.entries(scores).sort((x, y) => y[1] - x[1])[0];
  const confidence = top / total;
  const reason = reasons.join('; ');

  if (confidence < params.minConfidence) {
    return { regime: REGIME.UNCERTAIN, confidence, reason: `mixed signals: ${reason}`, scores, indicators };
  }
  return { regime: name, confidence, reason, scores, indicators };
}
