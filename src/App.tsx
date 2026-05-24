import { useState, useEffect, useRef } from 'react';
import type {
  Candle,
  Position,
  StrategySettings,
  RiskSettings,
  AccountState,
  LogMessage,
  BacktestResults,
} from './types';
import { computeAllIndicators } from './indicators';
import { evaluateStrategy } from './strategies';
import { generateCandles, generateNextTick, runBacktest } from './simulator';
import { TradingChart } from './components/TradingChart';
import { StrategyConfig } from './components/StrategyConfig';
import { OrderBook } from './components/OrderBook';
import { TradeLogs } from './components/TradeLogs';
import { BacktestPanel } from './components/BacktestPanel';
import {
  ShieldAlert,
  Activity,
  CheckCircle,
} from 'lucide-react';
import { AuthPage } from './components/AuthPage';

export default function App() {
  // --- Auth States ---
  const [userToken, setUserToken] = useState<string | null>(localStorage.getItem('userToken'));
  const [username, setUsername] = useState<string | null>(localStorage.getItem('username'));

  const handleLoginSuccess = (token: string, user: string) => {
    localStorage.setItem('userToken', token);
    localStorage.setItem('username', user);
    setUserToken(token);
    setUsername(user);
    setBotMode('EXCHANGE_LIVE');
  };

  const handleLogout = () => {
    localStorage.removeItem('userToken');
    localStorage.removeItem('username');
    setUserToken(null);
    setUsername(null);
    setExchangeStatus({
      connected: false,
      exchangeId: 'binance',
      isTestnet: true,
      balance: 0,
      equity: 0,
      dailyDrawdownPercent: 0,
      circuitBreakerTriggered: false,
    });
    setBotActive(false);
    setBotMode('MOCK_SIMULATOR');
  };

  // --- Settings States ---
  const [stratSettings, setStratSettings] = useState<StrategySettings>({
    strategyType: 'TREND_FOLLOWING',
    emaShortPeriod: 20,
    emaLongPeriod: 50,
    emaTrendPeriod: 200,
    rsiPeriod: 14,
    rsiOverbought: 75,
    rsiOversold: 25,
    atrPeriod: 14,
    adxThreshold: 30,
    useMultiTimeframe: true,
  });

  const [riskSettings, setRiskSettings] = useState<RiskSettings>({
    riskPercent: 1.0, // risk 1% of balance per trade
    riskRewardRatio: 2.0, // 1:2 risk to reward
    atrMultiplier: 2.0, // SL distance is 2 * ATR
    trailingStopEnabled: true,
    trailingStopTrigger: 1.2, // move SL to entry + offset when PnL hits 1.2x risk
    maxDailyDrawdown: 5.0, // 5% drawdown threshold
    leverage: 1, // 1x leverage by default
    maxConcurrentPositions: 3,
    partialTakeProfitEnabled: true,
  });

  const [showIndicators, setShowIndicators] = useState({
    ema20: true,
    ema50: true,
    ema200: true,
    bb: false,
  });

  // --- Bot/Simulator States ---
  const [candles, setCandles] = useState<Candle[]>([]);
  const [activePosition, setActivePosition] = useState<Position | null>(null);
  const [allPositions, setAllPositions] = useState<Position[]>([]);
  const [closedTrades, setClosedTrades] = useState<Position[]>([]);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [botActive, setBotActive] = useState(false);
  const [showWelcomeModal, setShowWelcomeModal] = useState(true);
  const [botMode, setBotMode] = useState<'MOCK_SIMULATOR' | 'EXCHANGE_LIVE'>('MOCK_SIMULATOR');
  const [exchangeStatus, setExchangeStatus] = useState<{
    connected: boolean;
    exchangeId: string;
    isTestnet: boolean;
    balance: number;
    equity?: number;
    dailyDrawdownPercent?: number;
    circuitBreakerTriggered?: boolean;
    maskedApiKey?: string;
    maskedApiSecret?: string;
  }>({
    connected: false,
    exchangeId: 'binance',
    isTestnet: true,
    balance: 0,
    equity: 0,
    dailyDrawdownPercent: 0,
    circuitBreakerTriggered: false,
    maskedApiKey: '',
    maskedApiSecret: '',
  });
  const [symbol, setSymbol] = useState('BTC/USDT, ETH/USDT, SOL/USDT, DOGE/USDT, ALGO/USDT, ADA/USDT');
  const [viewedSymbol, setViewedSymbol] = useState('BTC/USDT');

  // --- Account State ---
  const [account, setAccount] = useState<AccountState>({
    balance: 10000.0,
    equity: 10000.0,
    initialBalance: 10000.0,
    dailyStartBalance: 10000.0,
    totalProfit: 0.0,
    maxDrawdownReached: false,
    maxEquity: 10000.0,
    winCount: 0,
    lossCount: 0,
  });

  // --- Backtest Results State ---
  const [backtestResults, setBacktestResults] = useState<BacktestResults | null>(null);

  const [hasUnappliedChanges, setHasUnappliedChanges] = useState(false);
  const isFirstRender = useRef(true);

  // Track settings edits to show unapplied changes prompt
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setHasUnappliedChanges(true);
  }, [stratSettings, riskSettings, symbol]);

  // Refs for tracking counts and ticking
  const tickCountRef = useRef(0);
  const simIntervalRef = useRef<any>(null);
  const lastExitTimeRef = useRef<number | null>(null);

  // Add a log message helper
  const addLog = (text: string, type: LogMessage['type'] = 'info') => {
    setLogs((prev) => [
      ...prev,
      {
        id: Math.random().toString(),
        timestamp: Date.now(),
        type,
        text,
      },
    ].slice(-100)); // cap at 100 messages
  };

  // --- Initialize Historical Candles for Live Sim Chart ---
  useEffect(() => {
    // Generate 300 initial candles representing a ranging/consolidation market
    const initCandles = generateCandles('RANGING', 300, 50000);
    const withIndicators = computeAllIndicators(initCandles, stratSettings);
    setCandles(withIndicators);

    addLog('System initialized. Paper trading account funded with $10,000.', 'success');
    addLog('Risk Protection Module: Active. Position Sizer set to 1.0% risk rule.', 'info');
    addLog('Select strategy and click "Start Bot Simulation" to begin paper trading.', 'info');
  }, []);

  // Poll local CCXT Express server when EXCHANGE_LIVE mode is active
  useEffect(() => {
    if (botMode !== 'EXCHANGE_LIVE' || !userToken) return;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/status?symbol=${encodeURIComponent(viewedSymbol)}`, {
          headers: { 'Authorization': `Bearer ${userToken}` }
        });
        if (res.status === 401) {
          handleLogout();
          return;
        }
        if (res.ok) {
          const data = await res.json();
          setExchangeStatus({
            connected: data.connected,
            exchangeId: data.exchangeId,
            isTestnet: data.isTestnet,
            balance: data.balance,
            equity: data.equity,
            dailyDrawdownPercent: data.dailyDrawdownPercent,
            circuitBreakerTriggered: data.circuitBreakerTriggered,
            maskedApiKey: data.maskedApiKey,
            maskedApiSecret: data.maskedApiSecret,
          });
          setBotActive(data.botActive);
          setAllPositions(data.allPositions || []);

          // Auto-sync backend active settings to UI if no unapplied changes are pending
          if (!hasUnappliedChanges) {
            if (data.stratSettings) setStratSettings(data.stratSettings);
            if (data.riskSettings) setRiskSettings(data.riskSettings);
            if (data.activeSymbols) setSymbol(data.activeSymbols.join(', '));
          }
          
          if (data.activePosition) {
            setActivePosition(data.activePosition);
          } else {
            setActivePosition(null);
          }
          if (data.candles && data.candles.length > 0) {
            setCandles(data.candles);
          }
          setAccount(prev => ({
            ...prev,
            balance: data.balance,
            equity: data.equity || data.balance,
          }));
        }
      } catch (err) {
        console.error('Error fetching backend status:', err);
      }
    };

    const fetchLogs = async () => {
      try {
        const res = await fetch('/api/logs', {
          headers: { 'Authorization': `Bearer ${userToken}` }
        });
        if (res.status === 401) {
          handleLogout();
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (data.logs) {
            setLogs(data.logs);
          }
        }
      } catch (err) {
        console.error('Error fetching logs:', err);
      }
    };

    fetchStatus();
    fetchLogs();

    const interval = setInterval(() => {
      fetchStatus();
      fetchLogs();
    }, 2000);

    return () => clearInterval(interval);
  }, [botMode, viewedSymbol, userToken, hasUnappliedChanges]);

  const handleConnectExchange = async (
    exchangeId: string,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<boolean> => {
    try {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(userToken ? { 'Authorization': `Bearer ${userToken}` } : {})
        },
        body: JSON.stringify({ exchangeId, apiKey, apiSecret, isTestnet }),
      });
      if (res.status === 401) {
        handleLogout();
        return false;
      }
      if (res.ok) {
        const data = await res.json();
        setExchangeStatus({
          connected: true,
          exchangeId,
          isTestnet,
          balance: data.balance,
        });
        return true;
      }
      return false;
    } catch (e) {
      console.error('Error connecting to exchange:', e);
      return false;
    }
  };

  const handleDisconnectExchange = async () => {
    try {
      const res = await fetch('/api/disconnect', {
        method: 'POST',
        headers: userToken ? { 'Authorization': `Bearer ${userToken}` } : {}
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (res.ok) {
        setExchangeStatus({
          connected: false,
          exchangeId: 'binance',
          isTestnet: true,
          balance: 0,
          equity: 0,
          dailyDrawdownPercent: 0,
          circuitBreakerTriggered: false,
        });
        setBotActive(false);
      }
    } catch (e) {
      console.error('Error disconnecting from exchange:', e);
    }
  };

  const handleToggleBotActive = async (newActiveState: boolean) => {
    if (botMode === 'EXCHANGE_LIVE') {
      try {
        const activeSymbolsList = symbol.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        const res = await fetch('/api/toggle-bot', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(userToken ? { 'Authorization': `Bearer ${userToken}` } : {})
          },
          body: JSON.stringify({
            active: newActiveState,
            settings: stratSettings,
            risk: riskSettings,
            symbol: viewedSymbol,
            activeSymbols: activeSymbolsList,
          }),
        });
        if (res.status === 401) {
          handleLogout();
          return;
        }
        if (res.ok) {
          setBotActive(newActiveState);
          setHasUnappliedChanges(false); // Reset on apply
        }
      } catch (e) {
        console.error('Error toggling bot:', e);
      }
    } else {
      setBotActive(newActiveState);
      setHasUnappliedChanges(false); // Reset on apply
    }
  };

  // --- Trigger Re-calculations of Indicators when settings change ---
  useEffect(() => {
    if (candles.length > 0) {
      setCandles((prev) => computeAllIndicators(prev, stratSettings));
    }
  }, [
    stratSettings.strategyType,
    stratSettings.emaShortPeriod,
    stratSettings.emaLongPeriod,
    stratSettings.emaTrendPeriod,
    stratSettings.rsiPeriod,
    stratSettings.atrPeriod,
  ]);

  // --- Live Simulator Tick Loop ---
  useEffect(() => {
    if (!botActive || botMode === 'EXCHANGE_LIVE') {
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
      return;
    }

    addLog('Trading bot simulation started. Listening to market ticks...', 'warning');

    simIntervalRef.current = setInterval(() => {
      setCandles((prevCandles) => {
        if (prevCandles.length === 0) return prevCandles;

        // 1. Generate tick or next candle
        tickCountRef.current += 1;
        const isNewCandle = tickCountRef.current >= 12; // Complete candle every 12 ticks
        if (isNewCandle) {
          tickCountRef.current = 0;
        }

        // Generate small upward bias for trend following simulation to see trades
        const bias = stratSettings.strategyType === 'TREND_FOLLOWING' ? 0.00015 : 0;
        const lastCandle = prevCandles[prevCandles.length - 1];
        const nextCandleRaw = generateNextTick(lastCandle, 15, isNewCandle, bias);

        let newCandles = [...prevCandles];
        if (isNewCandle) {
          newCandles.push(nextCandleRaw);
          if (newCandles.length > 400) {
            newCandles.shift(); // keep length bounded
          }
        } else {
          newCandles[newCandles.length - 1] = nextCandleRaw;
        }

        // Re-compute indicators with new prices
        const calculatedCandles = computeAllIndicators(newCandles, stratSettings);
        const currentCandle = calculatedCandles[calculatedCandles.length - 1];
        const currentPrice = currentCandle.close;

        // 2. Manage Active Position (SL/TP & Trailing Stops)
        setActivePosition((currPos) => {
          if (!currPos) return null;

          let exitPrice = 0;
          let exitReason: Position['exitReason'] = undefined;
          
          // Compute floating PnL
          const diff = currPos.type === 'LONG'
            ? currentPrice - currPos.entryPrice
            : currPos.entryPrice - currentPrice;
          const pnl = diff * currPos.size * currPos.leverage;
          const pnlPercent = (pnl / (currPos.entryPrice * currPos.size)) * 100;

          // Track peak/valley for trailing stop
          const updatedPos = { ...currPos, pnl, pnlPercent };
          if (currPos.type === 'LONG') {
            updatedPos.maxObservedPrice = Math.max(currPos.maxObservedPrice || currPos.entryPrice, currentPrice);
          } else {
            updatedPos.minObservedPrice = Math.min(currPos.minObservedPrice || currPos.entryPrice, currentPrice);
          }

          // Trailing stop adjustment
          if (riskSettings.trailingStopEnabled) {
            const slDistance = Math.abs(currPos.entryPrice - currPos.stopLoss);
            
            if (currPos.type === 'LONG') {
              const triggerPrice = currPos.entryPrice + slDistance * riskSettings.trailingStopTrigger;
              if ((updatedPos.maxObservedPrice || 0) > triggerPrice) {
                // Move SL to entry + 20% risk offset (Guaranteed risk-free trade!)
                const newSL = parseFloat((currPos.entryPrice + slDistance * 0.2).toFixed(2));
                if (newSL > currPos.stopLoss) {
                  updatedPos.stopLoss = newSL;
                  addLog(`Trailing Stop adjusted higher for LONG to $${newSL}. Trade is now risk-free!`, 'info');
                }
              }
            } else {
              const triggerPrice = currPos.entryPrice - slDistance * riskSettings.trailingStopTrigger;
              if ((updatedPos.minObservedPrice || Infinity) < triggerPrice) {
                const newSL = parseFloat((currPos.entryPrice - slDistance * 0.2).toFixed(2));
                if (newSL < currPos.stopLoss) {
                  updatedPos.stopLoss = newSL;
                  addLog(`Trailing Stop adjusted lower for SHORT to $${newSL}. Trade is now risk-free!`, 'info');
                }
              }
            }
          }

          // Check if Stop Loss or Take Profit is hit
          if (currPos.type === 'LONG') {
            if (currentPrice <= updatedPos.stopLoss) {
              exitPrice = updatedPos.stopLoss;
              exitReason = riskSettings.trailingStopEnabled && exitPrice > currPos.entryPrice ? 'TRAILING_STOP' : 'SL';
            } else if (currentPrice >= updatedPos.takeProfit) {
              exitPrice = updatedPos.takeProfit;
              exitReason = 'TP';
            }
          } else {
            if (currentPrice >= updatedPos.stopLoss) {
              exitPrice = updatedPos.stopLoss;
              exitReason = riskSettings.trailingStopEnabled && exitPrice < currPos.entryPrice ? 'TRAILING_STOP' : 'SL';
            } else if (currentPrice <= updatedPos.takeProfit) {
              exitPrice = updatedPos.takeProfit;
              exitReason = 'TP';
            }
          }

          if (exitReason) {
            // Trigger Order Fill / Position Close
            const finalPnl = currPos.type === 'LONG'
              ? (exitPrice - currPos.entryPrice) * currPos.size * currPos.leverage
              : (currPos.entryPrice - exitPrice) * currPos.size * currPos.leverage;

            const closedPos: Position = {
              ...updatedPos,
              status: 'CLOSED',
              exitPrice,
              exitTime: currentCandle.time,
              exitReason,
              pnl: finalPnl,
              pnlPercent: (finalPnl / (currPos.entryPrice * currPos.size)) * 100,
            };

            // Update Account Balance
            setAccount((prevAcc) => {
              const nextBalance = prevAcc.balance + finalPnl;
              const isWin = finalPnl > 0;
              return {
                ...prevAcc,
                balance: nextBalance,
                equity: nextBalance,
                winCount: prevAcc.winCount + (isWin ? 1 : 0),
                lossCount: prevAcc.lossCount + (isWin ? 0 : 1),
                totalProfit: prevAcc.totalProfit + finalPnl,
              };
            });

            setClosedTrades((prevTrades) => [...prevTrades, closedPos]);
            
            const logMsg = exitReason === 'TP'
              ? `🎯 TAKE PROFIT hit at $${exitPrice.toFixed(2)}. Profit: +$${finalPnl.toFixed(2)}!`
              : exitReason === 'TRAILING_STOP'
              ? `🛡️ TRAILING STOP hit at $${exitPrice.toFixed(2)}. Capital preserved, profit secured: +$${finalPnl.toFixed(2)}.`
              : `🛑 STOP LOSS hit at $${exitPrice.toFixed(2)}. Loss locked: -$${Math.abs(finalPnl).toFixed(2)}.`;
            
            addLog(logMsg, exitReason === 'TP' || exitReason === 'TRAILING_STOP' ? 'success' : 'danger');
            lastExitTimeRef.current = currentCandle.time;

            return null; // clear active position
          }

          // Otherwise, update position floating PnL
          return updatedPos;
        });

        // 3. Evaluate entry rules (Only on closed candles to avoid repaint signals)
        if (isNewCandle && !activePosition) {
          // Check 3-candle cooldown (15 minutes on 5m timeframe)
          if (lastExitTimeRef.current && (currentCandle.time - lastExitTimeRef.current) < 3 * 5 * 60 * 1000) {
            return calculatedCandles;
          }
          const decision = evaluateStrategy(calculatedCandles, stratSettings);
          
          if (decision.signal) {
            const atrValue = currentCandle.atr || (currentCandle.high - currentCandle.low) || 5.0;
            const slDistance = atrValue * riskSettings.atrMultiplier;
            
            let slPrice = 0;
            let tpPrice = 0;
            
            if (decision.signal === 'BUY') {
              slPrice = currentPrice - slDistance;
              tpPrice = currentPrice + slDistance * riskSettings.riskRewardRatio;
            } else { // SELL
              slPrice = currentPrice + slDistance;
              tpPrice = currentPrice - slDistance * riskSettings.riskRewardRatio;
            }

            // --- THE 1% RISK POSITION SIZING MATH ---
            // Max loss allowed in USD = Account Balance * (riskPercent / 100)
            // Stop distance = slDistance
            // Sizing = MaxLossUSD / (Stop Distance * Leverage)
            setAccount((currAcc) => {
              const maxLossUsd = currAcc.balance * (riskSettings.riskPercent / 100);
              let size = maxLossUsd / slDistance;
              
              // Capital limits check (Leveraged Exposure cap)
              const exposure = size * currentPrice;
              const maxAllowedExposure = currAcc.balance * riskSettings.leverage;
              
              if (exposure > maxAllowedExposure) {
                size = maxAllowedExposure / currentPrice;
              }

              const newPos: Position = {
                id: `trade_${Date.now()}`,
                type: decision.signal === 'BUY' ? 'LONG' : 'SHORT',
                symbol: 'MOCKUSDT',
                entryPrice: currentPrice,
                entryTime: currentCandle.time,
                size,
                leverage: riskSettings.leverage,
                stopLoss: parseFloat(slPrice.toFixed(2)),
                takeProfit: parseFloat(tpPrice.toFixed(2)),
                pnl: 0,
                pnlPercent: 0,
                status: 'OPEN',
                maxObservedPrice: currentPrice,
                minObservedPrice: currentPrice,
              };

              setActivePosition(newPos);
              addLog(`🔔 Trade Signal triggered: ${decision.reason}`, 'trade');
              addLog(`📥 Executed ${newPos.type} Order. Size: ${size.toFixed(4)} MOCK ($${(size*currentPrice).toFixed(2)} exposure). SL: $${slPrice.toFixed(2)}, TP: $${tpPrice.toFixed(2)}. Calculated potential loss is exactly $${(size*slDistance).toFixed(2)} (${riskSettings.riskPercent}% risk).`, 'info');

              return currAcc;
            });
          }
        }

        return calculatedCandles;
      });
    }, 1000);

    return () => {
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    };
  }, [botActive, stratSettings, riskSettings, activePosition]);

  // --- Manual Close Position ---
  const handleManualClose = async (symbolToClose?: string) => {
    if (botMode === 'EXCHANGE_LIVE') {
      try {
        const res = await fetch('/api/close-position', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(userToken ? { 'Authorization': `Bearer ${userToken}` } : {})
          },
          body: JSON.stringify({ symbol: symbolToClose || viewedSymbol })
        });
        if (res.status === 401) {
          handleLogout();
          return;
        }
        if (res.ok) {
          addLog(`Manual market close order sent to exchange backend successfully for ${symbolToClose || viewedSymbol}.`, 'success');
        }
      } catch (e) {
        console.error('Error closing position:', e);
      }
      return;
    }

    if (!activePosition) return;
    const currentPrice = candles[candles.length - 1].close;
    const finalPnl = activePosition.type === 'LONG'
      ? (currentPrice - activePosition.entryPrice) * activePosition.size * activePosition.leverage
      : (activePosition.entryPrice - currentPrice) * activePosition.size * activePosition.leverage;

    const closedPos: Position = {
      ...activePosition,
      status: 'CLOSED',
      exitPrice: currentPrice,
      exitTime: Date.now(),
      exitReason: 'MANUAL',
      pnl: finalPnl,
      pnlPercent: (finalPnl / (activePosition.entryPrice * activePosition.size)) * 100,
    };

    setAccount((prevAcc) => {
      const nextBalance = prevAcc.balance + finalPnl;
      return {
        ...prevAcc,
        balance: nextBalance,
        equity: nextBalance,
        winCount: prevAcc.winCount + (finalPnl > 0 ? 1 : 0),
        lossCount: prevAcc.lossCount + (finalPnl <= 0 ? 1 : 0),
        totalProfit: prevAcc.totalProfit + finalPnl,
      };
    });

    setClosedTrades((prevTrades) => [...prevTrades, closedPos]);
    setActivePosition(null);
    lastExitTimeRef.current = Date.now();
    addLog(`⚠️ POSITION CLOSED MANUALLY at $${currentPrice.toFixed(2)}. PnL: ${finalPnl >= 0 ? '+' : ''}$${finalPnl.toFixed(2)}.`, 'warning');
  };

  // --- Run Historical Backtest ---
  const handleRunBacktest = (regime: 'BULL_TREND' | 'BEAR_TREND' | 'RANGING' | 'VOLATILE') => {
    addLog(`Running historical backtest on ${regime.replace('_', ' ')} (500 candles)...`, 'info');
    
    // Generate separate data for backtest
    const backtestCandles = generateCandles(regime, 500, 50000);
    const results = runBacktest(backtestCandles, stratSettings, riskSettings, account.balance);
    
    setBacktestResults(results);
    
    const pnlText = `${results.netProfitPercent >= 0 ? '+' : ''}${results.netProfitPercent.toFixed(2)}%`;
    addLog(`✅ Backtest completed. Net Profit: ${pnlText} (${results.wins}W / ${results.losses}L, Win Rate: ${results.winRate.toFixed(1)}%). Sharpe Ratio: ${results.sharpeRatio.toFixed(2)}. Max Drawdown: -${results.maxDrawdownPercent.toFixed(2)}%.`, 'success');
  };

  // Compute live portfolio stats
  const getWinRate = () => {
    const total = account.winCount + account.lossCount;
    return total > 0 ? (account.winCount / total) * 100 : 0;
  };

  const getProfitFactor = () => {
    if (closedTrades.length === 0) return 0;
    const wins = closedTrades.filter((t) => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
    const losses = Math.abs(closedTrades.filter((t) => t.pnl <= 0).reduce((sum, t) => sum + t.pnl, 0));
    return losses === 0 ? (wins > 0 ? 99.9 : 0) : wins / losses;
  };

  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : 50000;

  if (!userToken) {
    return <AuthPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="app-container">
      {/* HEADER SECTION */}
      <header className="header">
        <div className="logo-container">
          <Activity className="logo-glow" size={20} />
          <span>ApexBot <span style={{ fontWeight: 300, color: 'var(--text-secondary)' }}>Trading Desk</span></span>
        </div>

        {/* Global Live Metrics */}
        <div className="metrics-strip">
          <div className="metric-item">
            <span className="metric-label">Account Balance</span>
            <span className="metric-value value-mono">${account.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Total Net Profit</span>
            <span className={`metric-value value-mono ${account.totalProfit >= 0 ? 'green-text' : 'red-text'}`}>
              {account.totalProfit >= 0 ? '+' : ''}${account.totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Win Rate</span>
            <span className="metric-value value-mono">{getWinRate().toFixed(1)}%</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Profit Factor</span>
            <span className={`metric-value value-mono ${getProfitFactor() >= 1.5 ? 'green-text' : getProfitFactor() >= 1.0 ? 'gold-text' : 'red-text'}`}>
              {getProfitFactor().toFixed(2)}
            </span>
          </div>

          <div className="status-badge" style={{ marginLeft: '12px' }}>
            <span className={`status-dot ${botActive ? 'active' : ''}`}></span>
            <span>{botActive ? 'LIVE PAPER TRADING' : 'SIMULATION IDLE'}</span>
          </div>

          {userToken && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', borderLeft: '1px solid var(--border-color)', paddingLeft: '20px', marginLeft: '12px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>User: <strong style={{ color: 'var(--text-primary)' }}>{username}</strong></span>
              <button
                onClick={handleLogout}
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: 'var(--accent-red)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 10px',
                  fontSize: '11px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </header>

      {/* MAIN VIEW LAYOUT */}
      <div className="main-layout">
        {/* Left Control Panel */}
        <StrategyConfig
          stratSettings={stratSettings}
          setStratSettings={setStratSettings}
          riskSettings={riskSettings}
          setRiskSettings={setRiskSettings}
          botActive={botActive}
          setBotActive={handleToggleBotActive}
          showIndicators={showIndicators}
          setShowIndicators={setShowIndicators}
          botMode={botMode}
          setBotMode={setBotMode}
          exchangeStatus={exchangeStatus}
          onConnectExchange={handleConnectExchange}
          onDisconnectExchange={handleDisconnectExchange}
          symbol={symbol}
          setSymbol={setSymbol}
          hasUnappliedChanges={hasUnappliedChanges}
        />

        {/* Middle Charting & Backtesting Panels */}
        <div className="center-panel">
          <div className="dashboard-grid">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 16px', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Portfolio Basket:</span>
                <span className="badge badge-long">{symbol.split(',').map(s => s.trim().toUpperCase()).join(' | ')}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Inspect Chart:</span>
                <select
                  value={viewedSymbol}
                  onChange={(e) => setViewedSymbol(e.target.value)}
                  style={{
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '4px 8px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    cursor: 'pointer'
                  }}
                >
                  {symbol.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            <TradingChart
              candles={candles}
              activePosition={activePosition}
              closedTrades={closedTrades}
              showIndicators={showIndicators}
              symbol={viewedSymbol}
            />

            <div className="bottom-area">
              <BacktestPanel
                onRunBacktest={handleRunBacktest}
                results={backtestResults}
                riskSettings={riskSettings}
              />
              <TradeLogs
                activePosition={activePosition}
                closedTrades={closedTrades}
                logs={logs}
                onClosePosition={handleManualClose}
                latestPrice={currentPrice}
                allPositions={botMode === 'EXCHANGE_LIVE' ? allPositions : activePosition ? [activePosition] : []}
              />
            </div>
          </div>
        </div>

        {/* Right Order Book Visualizer */}
        <div className="right-panel">
          <OrderBook latestPrice={currentPrice} />
        </div>
      </div>

      {/* Welcome & Risk Explanation Modal */}
      {showWelcomeModal && (
        <div className="overlay">
          <div className="modal-content">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <ShieldAlert className="gold-text" size={28} />
              <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>Preserving Capital: The Low-Loss Framework</h2>
            </div>
            
            <div className="risk-alert-box">
              <div className="risk-alert-desc">
                <p style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}>
                  "How do top traders keep the chance of losing money extremely low?"
                </p>
                <p>
                  Professional algorithmic trading relies on <strong>strict mathematics</strong> rather than predicting the future. We have pre-configured this bot with the three core rules top traders use:
                </p>
              </div>
            </div>

            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
              <li style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <CheckCircle size={14} className="green-text" style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>
                  <strong style={{ color: 'var(--text-primary)' }}>1. The 1% Sizing Rule:</strong> The bot adjusts position size dynamically based on Stop Loss. If a trade fails, it loses exactly 1% of the account. It takes 100 straight losses to go broke.
                </span>
              </li>
              <li style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <CheckCircle size={14} className="green-text" style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>
                  <strong style={{ color: 'var(--text-primary)' }}>2. Volatility-Based Stop Losses (ATR):</strong> Stop losses are set outside of normal market noise (calculated via Average True Range), avoiding false stops.
                </span>
              </li>
              <li style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <CheckCircle size={14} className="green-text" style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>
                  <strong style={{ color: 'var(--text-primary)' }}>3. Positive Mathematical Expectancy (RRR):</strong> Setting Take Profits at 2x or 3x the Stop Loss distance ensures that a Win Rate of just 40% makes the system highly profitable.
                </span>
              </li>
            </ul>

            <button className="btn btn-primary" onClick={() => setShowWelcomeModal(false)}>
              Enter Trading Desk
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
