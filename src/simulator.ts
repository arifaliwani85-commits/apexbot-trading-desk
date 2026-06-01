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
  let activePositions: Position[] = [];
  
  // We start the backtest after 200 candles to ensure indicators are stabilized
  const startIdx = Math.max(200, Math.min(data.length - 10, 200));

  for (let i = startIdx; i < data.length; i++) {
    const currentCandle = data[i];
    const currentPrice = currentCandle.close;
    
    // Calculate floating equity
    let equity = balance;
    for (const pos of activePositions) {
      const priceDiff = pos.type === 'LONG' 
        ? currentPrice - pos.entryPrice 
        : pos.entryPrice - currentPrice;
      const tradePnl = priceDiff * pos.size * pos.leverage;
      equity += tradePnl;
    }
    
    maxEquity = Math.max(maxEquity, equity);
    const dd = ((maxEquity - equity) / maxEquity) * 100;
    maxDrawdown = Math.max(maxDrawdown, dd);

    // Enforce portfolio drawdown limit
    const portfolioDrawdownLimit = riskSettings.maxPortfolioDrawdown || 10.0;
    if (dd >= portfolioDrawdownLimit) {
      // Force close all positions
      for (const pos of activePositions) {
        const priceDiff = pos.type === 'LONG' 
          ? currentPrice - pos.entryPrice 
          : pos.entryPrice - currentPrice;
        const pnl = priceDiff * pos.size * pos.leverage;
        balance += pnl;
        
        trades.push({
          ...pos,
          status: 'CLOSED',
          exitPrice: currentPrice,
          exitTime: currentCandle.time,
          exitReason: 'DRAWDOWN',
          pnl,
          pnlPercent: (pnl / (pos.entryPrice * pos.size)) * 100,
        });
      }
      activePositions = [];
      maxDrawdown = Math.max(maxDrawdown, dd);
      break; // Stop backtest
    }

    // 2. If there are active positions, check if they hit stops or targets
    if (activePositions.length > 0) {
      const toCloseIds: string[] = [];
      const updatedPositions: Position[] = [];

      // First pass: Update indicators, maxObservedPrice, minObservedPrice and calculate floating PnL
      for (const pos of activePositions) {
        if (pos.type === 'LONG') {
          pos.maxObservedPrice = Math.max(pos.maxObservedPrice || pos.entryPrice, currentCandle.high);
        } else {
          pos.minObservedPrice = Math.min(pos.minObservedPrice || pos.entryPrice, currentCandle.low);
        }

        const priceDiff = pos.type === 'LONG'
          ? currentPrice - pos.entryPrice
          : pos.entryPrice - currentPrice;
        pos.pnl = priceDiff * pos.size * pos.leverage;
        pos.pnlPercent = (pos.pnl / (pos.entryPrice * pos.size)) * 100;
        pos.maxLeveragedPnL = Math.max(pos.maxLeveragedPnL || 0, pos.pnlPercent);
      }

      // Second pass: Evaluate exits
      for (const pos of activePositions) {
        if (toCloseIds.includes(pos.id)) continue;

        let exitPrice = 0;
        let exitReason: 'SL' | 'TP' | 'TRAILING_STOP' | 'MANUAL' | 'DRAWDOWN' | undefined;

        if (pos.isHedgedPair) {
          const paired = activePositions.find(p => p.id === pos.pairedPositionId && !toCloseIds.includes(p.id));
          const role = pos.hedgedRole;

          if (role === 'PRIMARY') {
            // SCENARIO A: Primary reaches +50% PnL -> Close primary, flag hedge as Scenario A
            if (pos.pnlPercent >= 50) {
              exitPrice = currentPrice;
              exitReason = 'TP';
              toCloseIds.push(pos.id);
              if (paired) {
                paired.hedgedScenario = 'A';
              }
            }
            // SCENARIO C: Primary reaches +60% PnL -> Trailing Profit mode
            else if (pos.pnlPercent >= 60 || pos.hedgedScenario === 'C') {
              pos.hedgedScenario = 'C';
              if (paired) paired.hedgedScenario = 'C';

              // Trailing stop checks: lock 30% of peak leveraged PnL
              if (pos.pnlPercent < 0.30 * (pos.maxLeveragedPnL || 0)) {
                exitPrice = currentPrice;
                exitReason = 'TRAILING_STOP';
                toCloseIds.push(pos.id);
              }
            }
            // SCENARIO B: If hedge was closed in Scenario B, primary scenario is B
            else if (pos.hedgedScenario === 'B') {
              if (pos.pnlPercent >= 40) {
                exitPrice = currentPrice;
                exitReason = 'TP';
                toCloseIds.push(pos.id);
              }
            }
          } else if (role === 'HEDGE') {
            // SCENARIO A: If primary closed in Scenario A, hedge's scenario is A
            if (pos.hedgedScenario === 'A') {
              if (pos.pnlPercent >= 10) {
                exitPrice = currentPrice;
                exitReason = 'TP';
                toCloseIds.push(pos.id);
              } else if (pos.pnlPercent <= -10) {
                exitPrice = currentPrice;
                exitReason = 'SL';
                toCloseIds.push(pos.id);
              }
            }
            // SCENARIO B: Hedge reaches +70% PnL and primary is losing -> Close hedge, flag primary as Scenario B
            else if (pos.pnlPercent >= 70 && paired && paired.pnlPercent < 0) {
              exitPrice = currentPrice;
              exitReason = 'TP';
              toCloseIds.push(pos.id);
              paired.hedgedScenario = 'B';
            }
            // SCENARIO C: Exit hedge if <= -80% PnL or >= +10% PnL
            else if (pos.hedgedScenario === 'C') {
              if (pos.pnlPercent <= -80) {
                exitPrice = currentPrice;
                exitReason = 'SL';
                toCloseIds.push(pos.id);
              } else if (pos.pnlPercent >= 10) {
                exitPrice = currentPrice;
                exitReason = 'TP';
                toCloseIds.push(pos.id);
              }
            }
          }
        }

        // Standard exit conditions if not exited by scenario
        if (!exitReason) {
          if (pos.type === 'LONG') {
            if (currentCandle.low <= pos.stopLoss) {
              exitPrice = pos.stopLoss;
              exitReason = riskSettings.trailingStopEnabled && exitPrice > pos.entryPrice ? 'TRAILING_STOP' : 'SL';
              toCloseIds.push(pos.id);
            } else if (currentCandle.high >= pos.takeProfit) {
              exitPrice = pos.takeProfit;
              exitReason = 'TP';
              toCloseIds.push(pos.id);
            }
          } else { // SHORT
            if (currentCandle.high >= pos.stopLoss) {
              exitPrice = pos.stopLoss;
              exitReason = riskSettings.trailingStopEnabled && exitPrice < pos.entryPrice ? 'TRAILING_STOP' : 'SL';
              toCloseIds.push(pos.id);
            } else if (currentCandle.low <= pos.takeProfit) {
              exitPrice = pos.takeProfit;
              exitReason = 'TP';
              toCloseIds.push(pos.id);
            }
          }
        }

        if (exitReason) {
          const pnl = pos.type === 'LONG'
            ? (exitPrice - pos.entryPrice) * pos.size * pos.leverage
            : (pos.entryPrice - exitPrice) * pos.size * pos.leverage;
          
          balance += pnl;
          
          trades.push({
            ...pos,
            status: 'CLOSED',
            exitPrice,
            exitTime: currentCandle.time,
            exitReason,
            pnl,
            pnlPercent: (pnl / (pos.entryPrice * pos.size)) * 100,
          });
        } else {
          updatedPositions.push(pos);
        }
      }

      activePositions = updatedPositions;
    }

    // 3. If no active position, check for a new signal
    const activeSymbolsCount = Array.from(new Set(activePositions.map(p => p.symbol))).length;
    if (activeSymbolsCount < (riskSettings.maxConcurrentPositions || 3)) {
      // Evaluate strategy on historical data slice
      const historySlice = data.slice(0, i + 1);
      const decision = evaluateStrategy(historySlice, stratSettings);
      
      if (decision.signal) {
        const atrValue = currentCandle.atr || (currentCandle.high - currentCandle.low) || 1.0;
        const atrPercent = (atrValue / currentPrice) * 100;
        const atrMin = riskSettings.volatilityAtrMin !== undefined ? riskSettings.volatilityAtrMin : 0.05;

        // Volatility Protection check (ATR min)
        if (atrPercent >= atrMin) {
          const slDistance = atrValue * riskSettings.atrMultiplier;
          
          let primaryType: 'LONG' | 'SHORT' = decision.signal === 'BUY' ? 'LONG' : 'SHORT';
          let hedgeType: 'LONG' | 'SHORT' = primaryType === 'LONG' ? 'SHORT' : 'LONG';

          // Apply The 1% Risk Rule to size the position
          const maxLossAllowed = balance * (riskSettings.riskPercent / 100);
          let positionSize = maxLossAllowed / slDistance;
          
          // Ensure size doesn't exceed maximum leverage capacity
          const totalCapitalRequired = positionSize * currentPrice;
          const maxAllowedExposure = balance * riskSettings.leverage;
          
          if (totalCapitalRequired > maxAllowedExposure) {
            positionSize = maxAllowedExposure / currentPrice;
          }

          const primaryId = `backtest_primary_${i}`;
          const hedgeId = `backtest_hedge_${i}`;

          if (riskSettings.hedgedDualExecutionEnabled) {
            const halfUsdt = balance * 0.5;
            const primaryLev = riskSettings.leverage;
            const hedgeLev = Math.max(1, Math.round(riskSettings.leverage / 2));

            const sizePrimary = (halfUsdt * primaryLev) / currentPrice;
            const sizeHedge = (halfUsdt * hedgeLev) / currentPrice;

            let primarySl = primaryType === 'LONG' ? currentPrice - slDistance : currentPrice + slDistance;
            let primaryTp = primaryType === 'LONG' ? currentPrice + slDistance * riskSettings.riskRewardRatio : currentPrice - slDistance * riskSettings.riskRewardRatio;

            // Primary Position
            const primaryPos: Position = {
              id: primaryId,
              type: primaryType,
              symbol: 'MOCKUSDT',
              entryPrice: currentPrice,
              entryTime: currentCandle.time,
              size: sizePrimary,
              leverage: primaryLev,
              stopLoss: parseFloat(primarySl.toFixed(2)),
              takeProfit: parseFloat(primaryTp.toFixed(2)),
              pnl: 0,
              pnlPercent: 0,
              status: 'OPEN',
              maxObservedPrice: currentPrice,
              minObservedPrice: currentPrice,
              isHedgedPair: true,
              hedgedRole: 'PRIMARY',
              hedgedScenario: 'NONE',
              pairedPositionId: hedgeId,
              maxLeveragedPnL: 0,
            };

            // Hedge Position
            let hedgeSl = hedgeType === 'LONG' ? currentPrice - slDistance : currentPrice + slDistance;
            let hedgeTp = hedgeType === 'LONG' ? currentPrice + slDistance * riskSettings.riskRewardRatio : currentPrice - slDistance * riskSettings.riskRewardRatio;

            const hedgePos: Position = {
              id: hedgeId,
              type: hedgeType,
              symbol: 'MOCKUSDT',
              entryPrice: currentPrice,
              entryTime: currentCandle.time,
              size: sizeHedge,
              leverage: hedgeLev,
              stopLoss: parseFloat(hedgeSl.toFixed(2)),
              takeProfit: parseFloat(hedgeTp.toFixed(2)),
              pnl: 0,
              pnlPercent: 0,
              status: 'OPEN',
              maxObservedPrice: currentPrice,
              minObservedPrice: currentPrice,
              isHedgedPair: true,
              hedgedRole: 'HEDGE',
              hedgedScenario: 'NONE',
              pairedPositionId: primaryId,
              maxLeveragedPnL: 0,
            };

            activePositions.push(primaryPos, hedgePos);
          } else {
            let slPrice = primaryType === 'LONG' ? currentPrice - slDistance : currentPrice + slDistance;
            let tpPrice = primaryType === 'LONG' ? currentPrice + slDistance * riskSettings.riskRewardRatio : currentPrice - slDistance * riskSettings.riskRewardRatio;

            activePositions.push({
              id: `backtest_single_${i}`,
              type: primaryType,
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
            });
          }
        }
      }
    }
  }

  // Force close any open positions at the end of simulation
  for (const pos of activePositions) {
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
