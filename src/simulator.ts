import type { Candle, Position, StrategySettings, RiskSettings, BacktestResults } from './types';
import { computeAllIndicators } from './indicators';
import { evaluateStrategy } from './strategies';

// Procedural generator for realistic cryptocurrency price data
export function generateCandles(
  regime: 'BULL_TREND' | 'BEAR_TREND' | 'RANGING' | 'VOLATILE',
  length: number = 500,
  startPrice: number = 50000,
  timeframeMinutes: number = 15
): Candle[] {
  const candles: Candle[] = [];
  let currentPrice = startPrice;
  let currentTime = Date.now() - length * timeframeMinutes * 60 * 1000;

  // Parameters based on regime
  let trendBias = 0;
  let noiseLevel = 0.005; // 0.5% standard deviation per candle

  if (regime === 'BULL_TREND') {
    trendBias = 0.0006; // upward drift
    noiseLevel = 0.004;
  } else if (regime === 'BEAR_TREND') {
    trendBias = -0.0008; // downward drift
    noiseLevel = 0.005;
  } else if (regime === 'RANGING') {
    trendBias = 0;
    noiseLevel = 0.003;
  } else if (regime === 'VOLATILE') {
    trendBias = 0;
    noiseLevel = 0.012; // high volatility
  }

  // Adding long-term wave patterns to create cycles
  const waveCycleLength = 120; // candles per cycle
  const waveAmplitude = 0.02; // 2% cycle height

  for (let i = 0; i < length; i++) {
    // Derivative of wave to add temporary drift
    const waveDrift = Math.cos((i / waveCycleLength) * Math.PI * 2) * (waveAmplitude / waveCycleLength);

    // Dynamic drift that depends on index for regime shifts
    let localTrend = trendBias + waveDrift;
    
    // Add special event: sudden flash crash in volatile regime or bear trend
    if (regime === 'VOLATILE' && i > 300 && i < 315) {
      localTrend = -0.02; // -2% per candle crash
    }
    if (regime === 'VOLATILE' && i >= 315 && i < 330) {
      localTrend = 0.015; // rapid recovery
    }

    const percentChange = localTrend + (Math.random() - 0.5) * noiseLevel * 2;
    const open = currentPrice;
    const close = currentPrice * (1 + percentChange);
    
    // High and Low based on open/close with random wick sizes
    const maxOC = Math.max(open, close);
    const minOC = Math.min(open, close);
    const wickHighMultiplier = 1 + Math.random() * (noiseLevel * 0.8);
    const wickLowMultiplier = 1 - Math.random() * (noiseLevel * 0.8);
    
    const high = maxOC * wickHighMultiplier;
    const low = minOC * wickLowMultiplier;
    const volume = Math.round(1000 + Math.random() * 5000 + (Math.abs(percentChange) * 100000));

    candles.push({
      time: currentTime,
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
      volume: parseFloat(volume.toFixed(0)),
    });

    currentPrice = close;
    currentTime += timeframeMinutes * 60 * 1000;
  }

  return candles;
}

// Generate a single live tick updating the current candle, or starting a new one
export function generateNextTick(
  lastCandle: Candle,
  timeframeMinutes: number = 15,
  isNewCandle: boolean,
  trendBias: number = 0
): Candle {
  const noise = 0.001; // 0.1% price movement per tick
  const change = trendBias + (Math.random() - 0.5) * noise * 2;
  const newPrice = parseFloat((lastCandle.close * (1 + change)).toFixed(2));

  if (isNewCandle) {
    const newTime = lastCandle.time + timeframeMinutes * 60 * 1000;
    return {
      time: newTime,
      open: lastCandle.close,
      high: Math.max(lastCandle.close, newPrice),
      low: Math.min(lastCandle.close, newPrice),
      close: newPrice,
      volume: Math.round(100 + Math.random() * 500),
    };
  } else {
    return {
      ...lastCandle,
      high: parseFloat(Math.max(lastCandle.high, newPrice).toFixed(2)),
      low: parseFloat(Math.min(lastCandle.low, newPrice).toFixed(2)),
      close: newPrice,
      volume: lastCandle.volume + Math.round(10 + Math.random() * 50),
    };
  }
}

// Run backtest over an array of pre-generated candles
export function runBacktest(
  candles: Candle[],
  stratSettings: StrategySettings,
  riskSettings: RiskSettings,
  startingBalance: number
): BacktestResults {
  // 1. Calculate all indicators on the candles first
  const data = computeAllIndicators(candles, stratSettings);
  
  let balance = startingBalance;
  let maxEquity = startingBalance;
  let maxDrawdown = 0;
  
  const trades: Position[] = [];
  let activePosition: Position | null = null;
  
  // We start the backtest after 200 candles to ensure indicators are stabilized
  const startIdx = Math.max(200, Math.min(data.length - 10, 200));

  for (let i = startIdx; i < data.length; i++) {
    const currentCandle = data[i];
    
    // Calculate floating equity
    const currentPrice = currentCandle.close;
    let equity = balance;
    if (activePosition) {
      const priceDiff = activePosition.type === 'LONG' 
        ? currentPrice - activePosition.entryPrice 
        : activePosition.entryPrice - currentPrice;
      const tradePnl = priceDiff * activePosition.size * activePosition.leverage;
      equity = balance + tradePnl;
    }
    
    maxEquity = Math.max(maxEquity, equity);
    const dd = ((maxEquity - equity) / maxEquity) * 100;
    maxDrawdown = Math.max(maxDrawdown, dd);

    // 2. If there is an active trade, check if it hits stops or targets
    if (activePosition) {
      const pos = activePosition;
      let exitPrice = 0;
      let exitReason: 'SL' | 'TP' | 'TRAILING_STOP' | 'MANUAL' | undefined;

      // Update max/min prices for trailing stop calculations
      if (pos.type === 'LONG') {
        pos.maxObservedPrice = Math.max(pos.maxObservedPrice || pos.entryPrice, currentCandle.high);
      } else {
        pos.minObservedPrice = Math.min(pos.minObservedPrice || pos.entryPrice, currentCandle.low);
      }

      // Check Trailing Stop adjustment
      if (riskSettings.trailingStopEnabled) {
        const slDistance = Math.abs(pos.entryPrice - pos.stopLoss);
        
        if (pos.type === 'LONG') {
          const profitLevel = pos.entryPrice + slDistance * riskSettings.trailingStopTrigger;
          // If price went past the trigger level, move SL to entry + locking in half of risk distance
          if ((pos.maxObservedPrice || 0) > profitLevel) {
            const newSL = pos.entryPrice + slDistance * 0.2; // entry + 20% risk distance (risk-free!)
            pos.stopLoss = Math.max(pos.stopLoss, newSL);
          }
        } else {
          const profitLevel = pos.entryPrice - slDistance * riskSettings.trailingStopTrigger;
          if ((pos.minObservedPrice || Infinity) < profitLevel) {
            const newSL = pos.entryPrice - slDistance * 0.2;
            pos.stopLoss = Math.min(pos.stopLoss, newSL);
          }
        }
      }

      // Check exit conditions on current candle range
      if (pos.type === 'LONG') {
        if (currentCandle.low <= pos.stopLoss) {
          exitPrice = pos.stopLoss;
          exitReason = riskSettings.trailingStopEnabled && exitPrice > pos.entryPrice ? 'TRAILING_STOP' : 'SL';
        } else if (currentCandle.high >= pos.takeProfit) {
          exitPrice = pos.takeProfit;
          exitReason = 'TP';
        }
      } else { // SHORT
        if (currentCandle.high >= pos.stopLoss) {
          exitPrice = pos.stopLoss;
          exitReason = riskSettings.trailingStopEnabled && exitPrice < pos.entryPrice ? 'TRAILING_STOP' : 'SL';
        } else if (currentCandle.low <= pos.takeProfit) {
          exitPrice = pos.takeProfit;
          exitReason = 'TP';
        }
      }

      if (exitReason) {
        // Close position
        const pnl = pos.type === 'LONG'
          ? (exitPrice - pos.entryPrice) * pos.size * pos.leverage
          : (pos.entryPrice - exitPrice) * pos.size * pos.leverage;
        
        balance += pnl;
        
        const closedPos: Position = {
          ...pos,
          status: 'CLOSED',
          exitPrice,
          exitTime: currentCandle.time,
          exitReason,
          pnl,
          pnlPercent: (pnl / (pos.entryPrice * pos.size)) * 100,
        };
        
        trades.push(closedPos);
        activePosition = null;
      }
    }

    // 3. If no active position, check for a new signal
    if (!activePosition) {
      // Evaluate strategy on historical data slice
      const historySlice = data.slice(0, i + 1);
      const decision = evaluateStrategy(historySlice, stratSettings);
      
      if (decision.signal) {
        const atrValue = currentCandle.atr || (currentCandle.high - currentCandle.low);
        const slDistance = atrValue * riskSettings.atrMultiplier;
        
        let slPrice = 0;
        let tpPrice = 0;
        
        if (decision.signal === 'BUY') {
          slPrice = currentPrice - slDistance;
          tpPrice = currentPrice + slDistance * riskSettings.riskRewardRatio;
        } else { // SELL (Short entry)
          slPrice = currentPrice + slDistance;
          tpPrice = currentPrice - slDistance * riskSettings.riskRewardRatio;
        }

        // Apply The 1% - 2% Risk Rule to size the position
        // Max dollar loss on this trade is balance * (riskPercent / 100)
        const maxLossAllowed = balance * (riskSettings.riskPercent / 100);
        
        // Loss per unit coin = Stop loss distance
        let positionSize = maxLossAllowed / slDistance;
        
        // Ensure size doesn't exceed maximum leverage capacity
        const totalCapitalRequired = positionSize * currentPrice;
        const maxAllowedLeveragedExposure = balance * riskSettings.leverage;
        
        if (totalCapitalRequired > maxAllowedLeveragedExposure) {
          positionSize = maxAllowedLeveragedExposure / currentPrice;
        }

        activePosition = {
          id: `backtest_${i}`,
          type: decision.signal === 'BUY' ? 'LONG' : 'SHORT',
          symbol: 'MOCKUSDT',
          entryPrice: currentPrice,
          entryTime: currentCandle.time,
          size: positionSize,
          leverage: riskSettings.leverage,
          stopLoss: parseFloat(slPrice.toFixed(2)),
          takeProfit: parseFloat(tpPrice.toFixed(2)),
          pnl: 0,
          pnlPercent: 0,
          status: 'OPEN',
          maxObservedPrice: currentPrice,
          minObservedPrice: currentPrice,
        };
      }
    }
  }

  // Force close any open position at the end of simulation
  if (activePosition) {
    const pos = activePosition;
    const finalPrice = data[data.length - 1].close;
    const pnl = pos.type === 'LONG'
      ? (finalPrice - pos.entryPrice) * pos.size * pos.leverage
      : (pos.entryPrice - finalPrice) * pos.size * pos.leverage;
    balance += pnl;

    trades.push({
      ...pos,
      status: 'CLOSED',
      exitPrice: finalPrice,
      exitTime: data[data.length - 1].time,
      exitReason: 'MANUAL',
      pnl,
      pnlPercent: (pnl / (pos.entryPrice * pos.size)) * 100,
    });
  }

  // Calculate statistics
  const totalTrades = trades.length;
  const wins = trades.filter((t) => (t.pnl || 0) > 0);
  const losses = trades.filter((t) => (t.pnl || 0) <= 0);
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
  
  const netProfitUsd = balance - startingBalance;
  const netProfitPercent = (netProfitUsd / startingBalance) * 100;
  
  let totalWinAmount = wins.reduce((acc, t) => acc + (t.pnl || 0), 0);
  let totalLossAmount = Math.abs(losses.reduce((acc, t) => acc + (t.pnl || 0), 0));
  const profitFactor = totalLossAmount === 0 
    ? (totalWinAmount > 0 ? 99.9 : 0) 
    : totalWinAmount / totalLossAmount;

  // Simple Sharpe ratio calculation (using average trade returns / std dev of trade returns)
  let sharpeRatio = 0;
  if (totalTrades > 1) {
    const returns = trades.map((t) => t.pnlPercent);
    const avgReturn = returns.reduce((acc, r) => acc + r, 0) / totalTrades;
    const variance = returns.reduce((acc, r) => acc + Math.pow(r - avgReturn, 2), 0) / (totalTrades - 1);
    const stdDev = Math.sqrt(variance);
    sharpeRatio = stdDev === 0 ? 0 : (avgReturn / stdDev) * Math.sqrt(totalTrades); // annualized-like estimation
  }

  return {
    totalTrades,
    wins: wins.length,
    losses: losses.length,
    winRate,
    netProfitPercent,
    netProfitUsd,
    maxDrawdownPercent: maxDrawdown,
    profitFactor,
    sharpeRatio,
    trades,
  };
}
