import type { Candle } from './types';

// Helper to calculate Simple Moving Average (SMA)
export function calculateSMA(prices: number[], period: number): number[] {
  const sma: number[] = [];
  let sum = 0;
  for (let i = 0; i < prices.length; i++) {
    sum += prices[i];
    if (i < period - 1) {
      sma.push(NaN);
    } else {
      if (i >= period) {
        sum -= prices[i - period];
      }
      sma.push(sum / period);
    }
  }
  return sma;
}

// Exponential Moving Average (EMA)
export function calculateEMA(prices: number[], period: number): number[] {
  const ema: number[] = [];
  if (prices.length === 0) return ema;

  const k = 2 / (period + 1);
  let prevEma = prices[0];

  // Initialize with SMA for the first element
  let sum = 0;
  for (let i = 0; i < Math.min(period, prices.length); i++) {
    sum += prices[i];
  }
  prevEma = sum / Math.min(period, prices.length);

  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      ema.push(NaN);
    } else if (i === period - 1) {
      ema.push(prevEma);
    } else {
      const curEma = prices[i] * k + prevEma * (1 - k);
      ema.push(curEma);
      prevEma = curEma;
    }
  }
  return ema;
}

// Standard Deviation helper
function calculateStandardDeviation(values: number[], mean: number): number {
  const sumOfSquares = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0);
  return Math.sqrt(sumOfSquares / values.length);
}

// Bollinger Bands
export function calculateBollingerBands(
  prices: number[],
  period: number = 20,
  multiplier: number = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = calculateSMA(prices, period);
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1 || isNaN(middle[i])) {
      upper.push(NaN);
      lower.push(NaN);
    } else {
      const slice = prices.slice(i - period + 1, i + 1);
      const stdDev = calculateStandardDeviation(slice, middle[i]);
      upper.push(middle[i] + multiplier * stdDev);
      lower.push(middle[i] - multiplier * stdDev);
    }
  }

  return { upper, middle, lower };
}

// Relative Strength Index (RSI)
export function calculateRSI(prices: number[], period: number = 14): number[] {
  const rsi: number[] = [];
  if (prices.length <= period) {
    return Array(prices.length).fill(NaN);
  }

  let avgGain = 0;
  let avgLoss = 0;

  // First values
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      avgGain += change;
    } else {
      avgLoss += Math.abs(change);
    }
  }

  avgGain /= period;
  avgLoss /= period;

  // Push NaNs for the first elements
  for (let i = 0; i < period; i++) {
    rsi.push(NaN);
  }

  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsi.push(100 - 100 / (1 + rs));
    }
  }

  return rsi;
}

// Moving Average Convergence Divergence (MACD)
export function calculateMACD(
  prices: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macdLine: number[]; signalLine: number[]; histogram: number[] } {
  const fastEma = calculateEMA(prices, fastPeriod);
  const slowEma = calculateEMA(prices, slowPeriod);

  const macdLine: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (isNaN(fastEma[i]) || isNaN(slowEma[i])) {
      macdLine.push(NaN);
    } else {
      macdLine.push(fastEma[i] - slowEma[i]);
    }
  }

  // Filter out NaNs for signal line calculation
  const validMacdStart = macdLine.findIndex((val) => !isNaN(val));
  const validMacdPrices = macdLine.slice(validMacdStart);
  const validSignalLine = calculateEMA(validSignalLinePricesOnly(validMacdPrices), signalPeriod);

  function validSignalLinePricesOnly(arr: number[]): number[] {
    return arr.map((v) => (isNaN(v) ? 0 : v));
  }

  const signalLine: number[] = [];
  const histogram: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    if (i < validMacdStart + signalPeriod - 1) {
      signalLine.push(NaN);
      histogram.push(NaN);
    } else {
      const signalVal = validSignalLine[i - validMacdStart];
      signalLine.push(signalVal);
      histogram.push(macdLine[i] - signalVal);
    }
  }

  return { macdLine, signalLine, histogram };
}

// Average True Range (ATR)
export function calculateATR(candles: Candle[], period: number = 14): number[] {
  const atr: number[] = [];
  if (candles.length === 0) return atr;

  const tr: number[] = [];

  // TR calculation
  tr.push(candles[0].high - candles[0].low);
  for (let i = 1; i < candles.length; i++) {
    const highLow = candles[i].high - candles[i].low;
    const highClose = Math.abs(candles[i].high - candles[i - 1].close);
    const lowClose = Math.abs(candles[i].low - candles[i - 1].close);
    tr.push(Math.max(highLow, highClose, lowClose));
  }

  // Initial ATR (SMA of TR)
  let sum = 0;
  for (let i = 0; i < Math.min(period, tr.length); i++) {
    sum += tr[i];
  }
  let prevAtr = sum / Math.min(period, tr.length);

  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      atr.push(NaN);
    } else if (i === period - 1) {
      atr.push(prevAtr);
    } else {
      const curAtr = (prevAtr * (period - 1) + tr[i]) / period;
      atr.push(curAtr);
      prevAtr = curAtr;
    }
  }

  return atr;
}

// Average Directional Index (ADX) using Wilder's smoothing technique
export function calculateADX(candles: Candle[], period: number = 14): number[] {
  const adx: number[] = Array(candles.length).fill(NaN);
  if (candles.length <= period * 2) return adx;

  const tr: number[] = [0];
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];

    const trVal = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    tr.push(trVal);

    const highDiff = curr.high - prev.high;
    const lowDiff = prev.low - curr.low;

    plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
    minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);
  }

  // Initial sums for smoothed values
  let smoothedTR = 0;
  let smoothedPlusDM = 0;
  let smoothedMinusDM = 0;

  for (let i = 1; i <= period; i++) {
    smoothedTR += tr[i];
    smoothedPlusDM += plusDM[i];
    smoothedMinusDM += minusDM[i];
  }

  const plusDI: number[] = Array(candles.length).fill(NaN);
  const minusDI: number[] = Array(candles.length).fill(NaN);
  const dx: number[] = Array(candles.length).fill(NaN);

  plusDI[period] = smoothedTR === 0 ? 0 : 100 * (smoothedPlusDM / smoothedTR);
  minusDI[period] = smoothedTR === 0 ? 0 : 100 * (smoothedMinusDM / smoothedTR);
  
  let diDiff = Math.abs(plusDI[period] - minusDI[period]);
  let diSum = plusDI[period] + minusDI[period];
  dx[period] = diSum === 0 ? 0 : 100 * (diDiff / diSum);

  // Wilder's Smoothing for TR, +DM, -DM
  for (let i = period + 1; i < candles.length; i++) {
    smoothedTR = smoothedTR - (smoothedTR / period) + tr[i];
    smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM / period) + plusDM[i];
    smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM / period) + minusDM[i];

    plusDI[i] = smoothedTR === 0 ? 0 : 100 * (smoothedPlusDM / smoothedTR);
    minusDI[i] = smoothedTR === 0 ? 0 : 100 * (smoothedMinusDM / smoothedTR);

    diDiff = Math.abs(plusDI[i] - minusDI[i]);
    diSum = plusDI[i] + minusDI[i];
    dx[i] = diSum === 0 ? 0 : 100 * (diDiff / diSum);
  }

  // Calculate ADX (Wilder's Smoothing on DX)
  let dxSum = 0;
  for (let i = period; i < period * 2; i++) {
    dxSum += dx[i];
  }
  let smoothedDX = dxSum / period;
  adx[period * 2 - 1] = smoothedDX;

  for (let i = period * 2; i < candles.length; i++) {
    smoothedDX = smoothedDX - (smoothedDX / period) + dx[i];
    adx[i] = smoothedDX;
  }

  return adx;
}

// Volume Weighted Average Price (VWAP) with daily reset at UTC Midnight
export function calculateVWAP(candles: Candle[]): number[] {
  const vwap: number[] = [];
  let cumVolume = 0;
  let cumPriceVolume = 0;
  let prevDay: number | null = null;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const date = new Date(candle.time);
    const day = date.getUTCDate();

    // Reset daily cumulative sums at UTC midnight
    if (prevDay !== null && day !== prevDay) {
      cumVolume = 0;
      cumPriceVolume = 0;
    }
    prevDay = day;

    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    const vol = candle.volume || 1; // avoid divide by zero if volume is missing
    cumVolume += vol;
    cumPriceVolume += typicalPrice * vol;

    vwap.push(cumPriceVolume / (cumVolume || 1));
  }

  return vwap;
}

// Utility to calculate all indicators on a set of candles
export function computeAllIndicators(
  candles: Candle[],
  stratSettings: {
    emaShortPeriod: number;
    emaLongPeriod: number;
    emaTrendPeriod: number;
    rsiPeriod: number;
    atrPeriod: number;
  }
): Candle[] {
  if (candles.length === 0) return candles;

  const closes = candles.map((c) => c.close);

  const emaShort = calculateEMA(closes, stratSettings.emaShortPeriod);
  const emaLong = calculateEMA(closes, stratSettings.emaLongPeriod);
  const emaTrend = calculateEMA(closes, stratSettings.emaTrendPeriod);
  const bb = calculateBollingerBands(closes, 20, 2);
  const rsi = calculateRSI(closes, stratSettings.rsiPeriod);
  const macdData = calculateMACD(closes, 12, 26, 9);
  const atr = calculateATR(candles, stratSettings.atrPeriod);
  const adx = calculateADX(candles, 14);
  const vwap = calculateVWAP(candles);

  return candles.map((candle, i) => ({
    ...candle,
    ema20: emaShort[i],
    ema50: emaLong[i],
    ema200: emaTrend[i],
    bbUpper: bb.upper[i],
    bbMiddle: bb.middle[i],
    bbLower: bb.lower[i],
    rsi: rsi[i],
    macd: isNaN(macdData.macdLine[i])
      ? undefined
      : {
          macdLine: macdData.macdLine[i],
          signalLine: macdData.signalLine[i],
          histogram: macdData.histogram[i],
        },
    atr: atr[i],
    adx: adx[i],
    vwap: vwap[i],
  }));
}
