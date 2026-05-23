import type { Candle, StrategySettings } from './types';

export interface SignalResult {
  signal: 'BUY' | 'SELL' | null;
  reason: string;
}

export function evaluateStrategy(
  candles: Candle[],
  settings: StrategySettings
): SignalResult {
  const len = candles.length;
  if (len < 5) return { signal: null, reason: 'Insufficient data' };

  const current = candles[len - 1];
  const previous = candles[len - 2];

  // We run checks based on the strategy type
  switch (settings.strategyType) {
    case 'TREND_FOLLOWING':
      return checkTrendFollowing(current, previous, settings);
    case 'MEAN_REVERSION':
      return checkMeanReversion(candles, settings);
    case 'MOMENTUM_BREAKOUT':
      return checkMomentumBreakout(candles, settings);
    default:
      return { signal: null, reason: 'Unknown strategy type' };
  }
}

// Trend Following strategy: EMA golden/death cross + trend filter (EMA 200) + RSI confirmation + ADX trend check + VWAP proximity check
function checkTrendFollowing(
  current: Candle,
  previous: Candle,
  settings: StrategySettings
): SignalResult {
  const { ema20: emaShortCurr, ema50: emaLongCurr, ema200: emaTrendCurr, rsi: rsiCurr, adx: adxCurr, vwap: vwapCurr } = current;
  const { ema20: emaShortPrev, ema50: emaLongPrev } = previous;

  const threshold = settings.adxThreshold || 25;

  if (
    emaShortCurr === undefined ||
    emaLongCurr === undefined ||
    emaTrendCurr === undefined ||
    emaShortPrev === undefined ||
    emaLongPrev === undefined ||
    rsiCurr === undefined ||
    adxCurr === undefined ||
    vwapCurr === undefined
  ) {
    return { signal: null, reason: 'Indicators not fully calculated' };
  }

  const isGoldenCross = emaShortPrev <= emaLongPrev && emaShortCurr > emaLongCurr;
  const isUpTrend = current.close > emaTrendCurr;
  const rsiNotOverbought = rsiCurr < settings.rsiOverbought;
  const hasStrongTrend = adxCurr > threshold;
  
  // Risk control: Buy when price is not too far above VWAP (e.g. within 2.5% of VWAP)
  const nearVWAPBuy = current.close <= vwapCurr * 1.025;

  if (isGoldenCross) {
    if (isUpTrend && rsiNotOverbought && hasStrongTrend && nearVWAPBuy) {
      return {
        signal: 'BUY',
        reason: `EMA Golden Cross. Price ($${current.close.toFixed(2)}) is above EMA200 ($${emaTrendCurr.toFixed(2)}) indicating uptrend. RSI is ${rsiCurr.toFixed(1)}. ADX is strong at ${adxCurr.toFixed(1)} (> ${threshold}). Price is near VWAP fair value ($${vwapCurr.toFixed(2)}).`,
      };
    } else if (!isUpTrend) {
      return { signal: null, reason: 'Golden Cross ignored: Price is below EMA200 (Long-term downtrend)' };
    } else if (!rsiNotOverbought) {
      return { signal: null, reason: `Golden Cross ignored: RSI (${rsiCurr.toFixed(1)}) is overbought` };
    } else if (!hasStrongTrend) {
      return { signal: null, reason: `Golden Cross ignored: Weak trend strength. ADX is ${adxCurr.toFixed(1)} (<= ${threshold})` };
    } else {
      return { signal: null, reason: `Golden Cross ignored: Price is too extended above VWAP ($${current.close.toFixed(2)} vs VWAP $${vwapCurr.toFixed(2)})` };
    }
  }

  // Bearish Death Cross: EMA20 crosses below EMA50 AND Price is below EMA200
  const isDeathCross = emaShortPrev >= emaLongPrev && emaShortCurr < emaLongCurr;
  const isDownTrend = current.close < emaTrendCurr;
  const rsiNotOversold = rsiCurr > settings.rsiOversold;
  
  // Risk control: Short when price is not too far below VWAP (e.g. within 2.5% of VWAP)
  const nearVWAPSell = current.close >= vwapCurr * 0.975;

  if (isDeathCross) {
    if (isDownTrend && rsiNotOversold && hasStrongTrend && nearVWAPSell) {
      return {
        signal: 'SELL',
        reason: `EMA Death Cross. Price ($${current.close.toFixed(2)}) is below EMA200 ($${emaTrendCurr.toFixed(2)}) indicating downtrend. RSI is ${rsiCurr.toFixed(1)}. ADX is strong at ${adxCurr.toFixed(1)} (> ${threshold}). Price is near VWAP fair value ($${vwapCurr.toFixed(2)}).`,
      };
    } else if (!isDownTrend) {
      return { signal: null, reason: 'Death Cross ignored: Price is above EMA200 (Long-term uptrend)' };
    } else if (!rsiNotOversold) {
      return { signal: null, reason: `Death Cross ignored: RSI (${rsiCurr.toFixed(1)}) is oversold` };
    } else if (!hasStrongTrend) {
      return { signal: null, reason: `Death Cross ignored: Weak trend strength. ADX is ${adxCurr.toFixed(1)} (<= ${threshold})` };
    } else {
      return { signal: null, reason: `Death Cross ignored: Price is too extended below VWAP ($${current.close.toFixed(2)} vs VWAP $${vwapCurr.toFixed(2)})` };
    }
  }

  return { signal: null, reason: 'No crossover detected' };
}

// Mean Reversion strategy: Bollinger Band touches + RSI + ADX filter (avoids catching falling knives in strong trends)
function checkMeanReversion(
  candles: Candle[],
  settings: StrategySettings
): SignalResult {
  const len = candles.length;
  const current = candles[len - 1];
  const previous = candles[len - 2];

  const { bbLower: bbLowerCurr, bbUpper: bbUpperCurr, rsi: rsiCurr, adx: adxCurr, vwap: vwapCurr } = current;
  const { bbLower: bbLowerPrev, bbUpper: bbUpperPrev } = previous;

  const threshold = settings.adxThreshold || 25;

  if (
    bbLowerCurr === undefined ||
    bbUpperCurr === undefined ||
    bbLowerPrev === undefined ||
    bbUpperPrev === undefined ||
    rsiCurr === undefined ||
    adxCurr === undefined ||
    vwapCurr === undefined
  ) {
    return { signal: null, reason: 'Bollinger Bands / RSI / ADX not fully calculated' };
  }

  // Institutional Rule: Do NOT mean revert a strong trend (only trade mean reversion when ADX is weak, indicating range-bound action)
  const isMarketRanging = adxCurr < threshold;

  // Buy Signal (Oversold Mean Reversion):
  const isPriceOversold = current.close <= bbLowerCurr || previous.close <= bbLowerPrev;
  const isRsiOversold = rsiCurr <= settings.rsiOversold;
  const isBelowVWAP = current.close < vwapCurr;

  if (isPriceOversold && isRsiOversold) {
    if (isMarketRanging && isBelowVWAP) {
      return {
        signal: 'BUY',
        reason: `Mean Reversion Buy: Price ($${current.close.toFixed(2)}) touched/closed below Lower Bollinger Band ($${bbLowerCurr.toFixed(2)}) and RSI is oversold at ${rsiCurr.toFixed(1)}. ADX is low at ${adxCurr.toFixed(1)} (< ${threshold}) indicating ranging market, and price is below VWAP ($${vwapCurr.toFixed(2)}).`,
      };
    } else if (!isMarketRanging) {
      return { signal: null, reason: `Mean Reversion Buy ignored: Trend is too strong. ADX is ${adxCurr.toFixed(1)} (>= ${threshold})` };
    } else {
      return { signal: null, reason: `Mean Reversion Buy ignored: Price is above VWAP fair value ($${vwapCurr.toFixed(2)})` };
    }
  }

  // Sell/Short Signal (Overbought Mean Reversion):
  const isPriceOverbought = current.close >= bbUpperCurr || previous.close >= bbUpperPrev;
  const isRsiOverbought = rsiCurr >= settings.rsiOverbought;
  const isAboveVWAP = current.close > vwapCurr;

  if (isPriceOverbought && isRsiOverbought) {
    if (isMarketRanging && isAboveVWAP) {
      return {
        signal: 'SELL',
        reason: `Mean Reversion Sell: Price ($${current.close.toFixed(2)}) touched/closed above Upper Bollinger Band ($${bbUpperCurr.toFixed(2)}) and RSI is overbought at ${rsiCurr.toFixed(1)}. ADX is low at ${adxCurr.toFixed(1)} (< ${threshold}) indicating ranging market, and price is above VWAP ($${vwapCurr.toFixed(2)}).`,
      };
    } else if (!isMarketRanging) {
      return { signal: null, reason: `Mean Reversion Sell ignored: Trend is too strong. ADX is ${adxCurr.toFixed(1)} (>= ${threshold})` };
    } else {
      return { signal: null, reason: `Mean Reversion Sell ignored: Price is below VWAP fair value ($${vwapCurr.toFixed(2)})` };
    }
  }

  return { signal: null, reason: 'Price is ranging within Bollinger Bands' };
}

// Momentum Breakout strategy: Highest High/Lowest Low breakout + Volume expansion + Rising Volatility (ATR) + ADX trend + VWAP check
function checkMomentumBreakout(
  candles: Candle[],
  settings: StrategySettings
): SignalResult {
  const len = candles.length;
  const lookback = 20;

  if (len <= lookback) {
    return { signal: null, reason: 'Insufficient lookback data' };
  }

  const current = candles[len - 1];
  const previous = candles[len - 2];
  const sliceForHighLow = candles.slice(len - 1 - lookback, len - 1); // exclude current candle

  let highestHigh = -Infinity;
  let lowestLow = Infinity;
  let totalVolume = 0;

  for (const c of sliceForHighLow) {
    if (c.high > highestHigh) highestHigh = c.high;
    if (c.low < lowestLow) lowestLow = c.low;
    totalVolume += c.volume;
  }

  const avgVolume = totalVolume / lookback;

  const { atr: atrCurr, adx: adxCurr, vwap: vwapCurr } = current;
  const { atr: atrPrev } = previous;

  const threshold = settings.adxThreshold || 25;

  if (atrCurr === undefined || atrPrev === undefined || adxCurr === undefined || vwapCurr === undefined) {
    return { signal: null, reason: 'ATR / ADX / VWAP not fully calculated' };
  }

  const isHighBreakout = current.close > highestHigh;
  const isVolumeExpanding = current.volume > avgVolume * 1.3;
  const isAtrRising = atrCurr > atrPrev;
  const hasStrongTrend = adxCurr > threshold;

  // Buy breakout when price confirms momentum (above VWAP)
  if (isHighBreakout) {
    if (isVolumeExpanding && isAtrRising && hasStrongTrend && current.close > vwapCurr) {
      return {
        signal: 'BUY',
        reason: `Momentum Breakout Buy: Price ($${current.close.toFixed(2)}) broke above ${lookback}-period high ($${highestHigh.toFixed(2)}) with volume expanding to ${(current.volume / avgVolume).toFixed(1)}x avg, rising ATR, and strong ADX trend (${adxCurr.toFixed(1)} > ${threshold}). Price is above VWAP ($${vwapCurr.toFixed(2)}).`,
      };
    } else if (!isVolumeExpanding) {
      return { signal: null, reason: `Breakout ignored: Volume expansion insufficient (${(current.volume / avgVolume).toFixed(1)}x average)` };
    } else if (!isAtrRising) {
      return { signal: null, reason: 'Breakout ignored: Volatility (ATR) is not expanding' };
    } else if (!hasStrongTrend) {
      return { signal: null, reason: `Breakout ignored: Trend is weak. ADX is ${adxCurr.toFixed(1)} (<= ${threshold})` };
    } else {
      return { signal: null, reason: `Breakout ignored: Price is below VWAP fair value ($${vwapCurr.toFixed(2)})` };
    }
  }

  const isLowBreakout = current.close < lowestLow;

  // Sell breakout when price confirms momentum (below VWAP)
  if (isLowBreakout) {
    if (isVolumeExpanding && isAtrRising && hasStrongTrend && current.close < vwapCurr) {
      return {
        signal: 'SELL',
        reason: `Momentum Breakout Sell: Price ($${current.close.toFixed(2)}) broke below ${lookback}-period low ($${lowestLow.toFixed(2)}) with volume expanding to ${(current.volume / avgVolume).toFixed(1)}x avg, rising ATR, and strong ADX trend (${adxCurr.toFixed(1)} > ${threshold}). Price is below VWAP ($${vwapCurr.toFixed(2)}).`,
      };
    } else if (!isVolumeExpanding) {
      return { signal: null, reason: `Breakout ignored: Volume expansion insufficient (${(current.volume / avgVolume).toFixed(1)}x average)` };
    } else if (!isAtrRising) {
      return { signal: null, reason: 'Breakout ignored: Volatility (ATR) is not expanding' };
    } else if (!hasStrongTrend) {
      return { signal: null, reason: `Breakout ignored: Trend is weak. ADX is ${adxCurr.toFixed(1)} (<= ${threshold})` };
    } else {
      return { signal: null, reason: `Breakout ignored: Price is above VWAP fair value ($${vwapCurr.toFixed(2)})` };
    }
  }

  return { signal: null, reason: 'Price is consolidating within range' };
}
