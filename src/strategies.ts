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

  // We run checks based on the strategy type
  switch (settings.strategyType) {
    case 'TREND_FOLLOWING':
      return checkTrendFollowing(current, settings, candles);
    case 'MEAN_REVERSION':
      return checkMeanReversion(candles, settings);
    case 'MOMENTUM_BREAKOUT':
      return checkMomentumBreakout(candles, settings);
    case 'HIGH_FREQUENCY_SCALPER':
      return checkHighFrequencyScalper(candles, settings);
    default:
      return { signal: null, reason: 'Unknown strategy type' };
  }
}

// Trend Following strategy: EMA state-based trend + pullback zone + RSI + ADX + VWAP proximity check
function checkTrendFollowing(
  current: Candle,
  settings: StrategySettings,
  candles: Candle[]
): SignalResult {
  const { ema20, ema50, ema200, rsi, adx, vwap } = current;

  const threshold = settings.adxThreshold !== undefined ? settings.adxThreshold : 25;

  if (
    ema20 === undefined ||
    ema50 === undefined ||
    ema200 === undefined ||
    rsi === undefined ||
    adx === undefined ||
    vwap === undefined
  ) {
    return { signal: null, reason: 'Indicators not fully calculated' };
  }

  // 1. ADX Trend check
  if (adx < threshold) {
    return { signal: null, reason: `ADX (${adx.toFixed(1)}) is below threshold (${threshold}) - choppy sideways market` };
  }

  // 2. Volume check (avoid low volume chop)
  const len = candles.length;
  const lookback = 20;
  if (len >= lookback) {
    let totalVol = 0;
    for (let i = len - 1 - lookback; i < len - 1; i++) {
      totalVol += candles[i].volume || 1;
    }
    const avgVol = totalVol / lookback;
    if (current.volume < avgVol * 0.8) {
      return { signal: null, reason: `Low volume: current candle volume (${current.volume.toFixed(0)}) < 80% of average (${(avgVol * 0.8).toFixed(0)})` };
    }
  }

  // 3. Trend Direction
  const isBullish = ema20 > ema50 && current.close > ema200;
  const isBearish = ema20 < ema50 && current.close < ema200;

  if (isBullish) {
    if (rsi >= settings.rsiOverbought) {
      return { signal: null, reason: `Uptrend BUY ignored: RSI (${rsi.toFixed(1)}) is overbought (>= ${settings.rsiOverbought})` };
    }
    const isPullback = current.close <= ema20 * 1.003;
    if (!isPullback) {
      return { signal: null, reason: `Uptrend BUY ignored: Price is too extended above EMA20 ($${current.close.toFixed(2)} vs EMA20 $${ema20.toFixed(2)})` };
    }
    if (current.close > vwap * 1.005) {
      return { signal: null, reason: `Uptrend BUY ignored: Price is too extended above VWAP ($${current.close.toFixed(2)} vs VWAP $${vwap.toFixed(2)})` };
    }

    return {
      signal: 'BUY',
      reason: `Trend Follow Buy: EMA20 > EMA50 ($${ema20.toFixed(2)} > $${ema50.toFixed(2)}), Close > EMA200 ($${current.close.toFixed(2)} > $${ema200.toFixed(2)}), RSI (${rsi.toFixed(1)}) healthy, price near EMA20 pullback zone`
    };
  }

  if (isBearish) {
    if (rsi <= settings.rsiOversold) {
      return { signal: null, reason: `Downtrend SELL ignored: RSI (${rsi.toFixed(1)}) is oversold (<= ${settings.rsiOversold})` };
    }
    const isPullback = current.close >= ema20 * 0.997;
    if (!isPullback) {
      return { signal: null, reason: `Downtrend SELL ignored: Price is too extended below EMA20 ($${current.close.toFixed(2)} vs EMA20 $${ema20.toFixed(2)})` };
    }
    if (current.close < vwap * 0.995) {
      return { signal: null, reason: `Downtrend SELL ignored: Price is too extended below VWAP ($${current.close.toFixed(2)} vs VWAP $${vwap.toFixed(2)})` };
    }

    return {
      signal: 'SELL',
      reason: `Trend Follow Sell: EMA20 < EMA50 ($${ema20.toFixed(2)} < $${ema50.toFixed(2)}), Close < EMA200 ($${current.close.toFixed(2)} < $${ema200.toFixed(2)}), RSI (${rsi.toFixed(1)}) healthy, price near EMA20 pullback zone`
    };
  }

  return { signal: null, reason: 'EMAs or Price not aligned in a trend' };
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

function checkHighFrequencyScalper(
  candles: Candle[],
  settings: StrategySettings
): SignalResult {
  const len = candles.length;
  if (len < 5) return { signal: null, reason: 'Insufficient data' };

  const current = candles[len - 1];
  const { ema20, ema50, rsi } = current;

  if (
    ema20 === undefined ||
    ema50 === undefined ||
    rsi === undefined
  ) {
    return { signal: null, reason: 'Indicators not fully calculated' };
  }

  const isBullish = ema20 > ema50;
  const isBearish = ema20 < ema50;

  if (isBullish) {
    if (rsi >= settings.rsiOverbought) {
      return { signal: null, reason: `Scalp BUY ignored: RSI (${rsi.toFixed(1)}) is overbought (>= ${settings.rsiOverbought})` };
    }
    const isPullback = current.close <= ema20 * 1.005;
    if (!isPullback) {
      return { signal: null, reason: `Scalp BUY ignored: Price is too extended above EMA20 ($${current.close.toFixed(2)} vs EMA20 $${ema20.toFixed(2)})` };
    }

    return {
      signal: 'BUY',
      reason: `HF Scalp Buy: EMA20 > EMA50 ($${ema20.toFixed(2)} > $${ema50.toFixed(2)}) and RSI is healthy at ${rsi.toFixed(1)}`
    };
  }

  if (isBearish) {
    if (rsi <= settings.rsiOversold) {
      return { signal: null, reason: `Scalp SELL ignored: RSI (${rsi.toFixed(1)}) is oversold (<= ${settings.rsiOversold})` };
    }
    const isPullback = current.close >= ema20 * 0.995;
    if (!isPullback) {
      return { signal: null, reason: `Scalp SELL ignored: Price is too extended below EMA20 ($${current.close.toFixed(2)} vs EMA20 $${ema20.toFixed(2)})` };
    }

    return {
      signal: 'SELL',
      reason: `HF Scalp Sell: EMA20 < EMA50 ($${ema20.toFixed(2)} < $${ema50.toFixed(2)}) and RSI is healthy at ${rsi.toFixed(1)}`
    };
  }

  return { signal: null, reason: 'EMA20 and EMA50 are crossing or flat' };
}
