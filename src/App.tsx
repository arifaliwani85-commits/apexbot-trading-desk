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
    hedgedDualExecutionEnabled: true,
    maxPortfolioDrawdown: 10.0,
    volatilityAtrMin: 0.05,
    volatilitySpreadMax: 0.1,
  });

  const [showIndicators, setShowIndicators] = useState({
    ema20: true,
    ema50: true,
    ema200: true,
    bb: false,
  });

  // --- Bot/Simulator States ---
  const [candles, setCandles] = useState<Candle[]>([]);
  const [_activePosition, setActivePosition] = useState<Position | null>(null);
  const [simulatorPositions, setSimulatorPositions] = useState<Position[]>([]);
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
    isHedgeMode?: boolean;
    rpm?: number;
    rateLimitRemaining?: number;
    lastRateLimitEvent?: number | null;
    scanPaused?: boolean;
    wsConnected?: boolean;
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
    isHedgeMode: false,
    rpm: 0,
    rateLimitRemaining: 1000,
    lastRateLimitEvent: null,
    scanPaused: false,
    wsConnected: false,
  });
  const [symbol, setSymbol] = useState('BTC/USDT, ETH/USDT, SOL/USDT, DOGE/USDT, ALGO/USDT, ADA/USDT, XRP/USDT, LTC/USDT, LINK/USDT, DOT/USDT, AVAX/USDT, BNB/USDT, NEAR/USDT, MATIC/USDT, UNI/USDT, SUI/USDT, APT/USDT');
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

  // --- Real-time Evaluation Diagnostics ---
  const [evaluationStates, setEvaluationStates] = useState<Record<string, any>>({});

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
  const seenPositionIdsRef = useRef<string[]>([]);

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
            isHedgeMode: data.isHedgeMode,
            rpm: data.rpm,
            rateLimitRemaining: data.rateLimitRemaining,
            lastRateLimitEvent: data.lastRateLimitEvent,
            scanPaused: data.scanPaused,
            wsConnected: data.wsConnected,
          });
          setBotActive(data.botActive);
          setAllPositions(data.allPositions || []);

          // Detect new positions opened to auto-switch chart
          if (data.allPositions) {
            const currentOpenPositions = data.allPositions.filter((pos: any) => pos.status === 'OPEN');
            const newOpenPosition = currentOpenPositions.find((pos: any) => !seenPositionIdsRef.current.includes(pos.id));
            if (newOpenPosition) {
              const baseSymbol = newOpenPosition.symbol.split(':')[0];
              setViewedSymbol(baseSymbol);
            }
            // Update the ref to the current list of open position IDs
            seenPositionIdsRef.current = currentOpenPositions.map((pos: any) => pos.id);
          }
          if (data.evaluationStates) {
            setEvaluationStates(data.evaluationStates);
          }

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
    isTestnet: boolean,
    apiPassphrase?: string,
    positionMode?: string
  ): Promise<boolean> => {
    try {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(userToken ? { 'Authorization': `Bearer ${userToken}` } : {})
        },
        body: JSON.stringify({ exchangeId, apiKey, apiSecret, isTestnet, apiPassphrase, positionMode }),
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
      if (newActiveState) {
        setAccount(prev => ({
          ...prev,
          maxDrawdownReached: false,
          dailyStartBalance: prev.balance,
          maxEquity: prev.balance,
        }));
      }
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
        setSimulatorPositions((prevPositions) => {
          if (prevPositions.length === 0) return [];

          let updatedPositions = [...prevPositions];
          const toCloseIds: string[] = [];
          const nextPositions = [];

          // Compute floating PnLs and peak extremes first
          updatedPositions = updatedPositions.map(pos => {
            const diff = pos.type === 'LONG'
              ? currentPrice - pos.entryPrice
              : pos.entryPrice - currentPrice;
            const pnl = diff * pos.size * pos.leverage;
            const pnlPercent = (pnl / (pos.entryPrice * pos.size)) * 100;
            
            const updated = { ...pos, pnl, pnlPercent };
            updated.maxLeveragedPnL = Math.max(updated.maxLeveragedPnL || 0, pnlPercent);

            if (pos.type === 'LONG') {
              updated.maxObservedPrice = Math.max(pos.maxObservedPrice || pos.entryPrice, currentPrice);
            } else {
              updated.minObservedPrice = Math.min(pos.minObservedPrice || pos.entryPrice, currentPrice);
            }
            return updated;
          });

          // Evaluate exits for each position
          for (const pos of updatedPositions) {
            if (toCloseIds.includes(pos.id)) continue;

            let exitPrice = 0;
            let exitReason: 'SL' | 'TP' | 'MANUAL' | 'TRAILING_STOP' | 'DRAWDOWN' | undefined = undefined;

            if (pos.isHedgedPair) {
              const paired = updatedPositions.find(p => p.id === pos.pairedPositionId && !toCloseIds.includes(p.id));
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
                  addLog(`[HEDGE ENGINE] Simulator: Scenario A triggered for MOCKUSDT: Primary reached +50% PnL. Closing...`, 'success');
                }
                // SCENARIO C: Primary reaches +60% PnL -> Trailing stop at 30% peak PnL
                else if (pos.pnlPercent >= 60 || pos.hedgedScenario === 'C') {
                  if (pos.hedgedScenario !== 'C') {
                    pos.hedgedScenario = 'C';
                    if (paired) paired.hedgedScenario = 'C';
                    addLog(`[HEDGE ENGINE] Simulator: Scenario C triggered for MOCKUSDT: Primary reached +60% PnL. Trailing Profit active.`, 'success');
                  }
                  const trailingFloor = 0.30 * (pos.maxLeveragedPnL || 0);
                  if (pos.pnlPercent < trailingFloor) {
                    exitPrice = currentPrice;
                    exitReason = 'TRAILING_STOP';
                    toCloseIds.push(pos.id);
                    addLog(`[HEDGE ENGINE] Simulator: Trailing Stop hit for Primary. Closed at ${pos.pnlPercent.toFixed(1)}% PnL.`, 'warning');
                  }
                }
                // SCENARIO B: If primary is in Scenario B monitoring
                else if (pos.hedgedScenario === 'B') {
                  if (pos.pnlPercent >= 40) {
                    exitPrice = currentPrice;
                    exitReason = 'TP';
                    toCloseIds.push(pos.id);
                    addLog(`[HEDGE ENGINE] Simulator: Scenario B recovery hit. Primary closed at +40% PnL.`, 'success');
                  }
                }
              } else if (role === 'HEDGE') {
                // SCENARIO A: If primary closed, monitor Scenario A
                if (pos.hedgedScenario === 'A') {
                  if (pos.pnlPercent >= 10) {
                    exitPrice = currentPrice;
                    exitReason = 'TP';
                    toCloseIds.push(pos.id);
                    addLog(`[HEDGE ENGINE] Simulator: Scenario A Hedge profit target (+10%) hit. Closing...`, 'success');
                  } else if (pos.pnlPercent <= -10) {
                    exitPrice = currentPrice;
                    exitReason = 'SL';
                    toCloseIds.push(pos.id);
                    addLog(`[HEDGE ENGINE] Simulator: Scenario A Hedge stop loss (-10%) hit. Closing...`, 'danger');
                  }
                }
                // SCENARIO B: Hedge reaches +70% PnL and primary is losing -> Close hedge, flag primary as Scenario B
                else if (pos.pnlPercent >= 70 && paired && paired.pnlPercent < 0) {
                  exitPrice = currentPrice;
                  exitReason = 'TP';
                  toCloseIds.push(pos.id);
                  paired.hedgedScenario = 'B';
                  addLog(`[HEDGE ENGINE] Simulator: Scenario B triggered. Hedge reached +70% PnL. Closing hedge.`, 'success');
                }
                // SCENARIO C: Under Scenario C: exit hedge if <= -80% PnL or >= +10% PnL
                else if (pos.hedgedScenario === 'C') {
                  if (pos.pnlPercent <= -80) {
                    exitPrice = currentPrice;
                    exitReason = 'SL';
                    toCloseIds.push(pos.id);
                    addLog(`[HEDGE ENGINE] Simulator: Scenario C Hedge hit stop loss (-80% PnL). Closing...`, 'danger');
                  } else if (pos.pnlPercent >= 10) {
                    exitPrice = currentPrice;
                    exitReason = 'TP';
                    toCloseIds.push(pos.id);
                    addLog(`[HEDGE ENGINE] Simulator: Scenario C Hedge hit profit target (+10% PnL). Closing...`, 'success');
                  }
                }
              }
            }

            // Fallback to standard exits (SL / TP / Trailing Stop) if scenario did not trigger exit
            if (!exitReason) {
              if (pos.type === 'LONG') {
                if (currentPrice <= pos.stopLoss) {
                  exitPrice = pos.stopLoss;
                  exitReason = riskSettings.trailingStopEnabled && exitPrice > pos.entryPrice ? 'TRAILING_STOP' : 'SL';
                  toCloseIds.push(pos.id);
                } else if (currentPrice >= pos.takeProfit) {
                  exitPrice = pos.takeProfit;
                  exitReason = 'TP';
                  toCloseIds.push(pos.id);
                }
              } else {
                if (currentPrice >= pos.stopLoss) {
                  exitPrice = pos.stopLoss;
                  exitReason = riskSettings.trailingStopEnabled && exitPrice < pos.entryPrice ? 'TRAILING_STOP' : 'SL';
                  toCloseIds.push(pos.id);
                } else if (currentPrice <= pos.takeProfit) {
                  exitPrice = pos.takeProfit;
                  exitReason = 'TP';
                  toCloseIds.push(pos.id);
                }
              }
            }

            if (exitReason) {
              const finalPnl = pos.type === 'LONG'
                ? (exitPrice - pos.entryPrice) * pos.size * pos.leverage
                : (pos.entryPrice - exitPrice) * pos.size * pos.leverage;

              const closedPos: Position = {
                ...pos,
                status: 'CLOSED',
                exitPrice,
                exitTime: currentCandle.time,
                exitReason,
                pnl: finalPnl,
                pnlPercent: (finalPnl / (pos.entryPrice * pos.size)) * 100,
              };

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
            } else {
              nextPositions.push(pos);
            }
          }

          // Compute final net unrealized PnL for positions that remain open
          let netUnrealizedPnL = 0;
          nextPositions.forEach(pos => {
            netUnrealizedPnL += pos.pnl || 0;
          });

          const currentEquity = account.balance + netUnrealizedPnL;
          const nextMaxEquity = Math.max(account.maxEquity || currentEquity, currentEquity);

          // Compute drawdowns
          let dailyDD = 0;
          if (account.dailyStartBalance > 0 && currentEquity < account.dailyStartBalance) {
            dailyDD = ((account.dailyStartBalance - currentEquity) / account.dailyStartBalance) * 100;
          }

          let portfolioDD = 0;
          if (nextMaxEquity > 0) {
            portfolioDD = ((nextMaxEquity - currentEquity) / nextMaxEquity) * 100;
          }

          // Circuit Breakers
          const maxDailyDD = riskSettings.maxDailyDrawdown;
          const maxPortfolioDD = riskSettings.maxPortfolioDrawdown || 10.0;

          if ((dailyDD >= maxDailyDD || portfolioDD >= maxPortfolioDD) && !account.maxDrawdownReached) {
            const reason = dailyDD >= maxDailyDD
              ? `Daily Max Drawdown limit (${maxDailyDD}%) hit! (Current: -${dailyDD.toFixed(2)}%)`
              : `Portfolio Max Drawdown limit (${maxPortfolioDD}%) hit! (Current: -${portfolioDD.toFixed(2)}%)`;

            setTimeout(() => {
              setBotActive(false);
              addLog(`[CRITICAL] Simulator: ${reason}. Triggering Emergency Circuit Breaker. Closing all positions...`, 'danger');
              
              setSimulatorPositions(activePos => {
                const closedList = activePos.map(pos => {
                  const diff = pos.type === 'LONG' ? currentPrice - pos.entryPrice : pos.entryPrice - currentPrice;
                  const finalPnl = diff * pos.size * pos.leverage;
                  return {
                    ...pos,
                    status: 'CLOSED' as const,
                    exitPrice: currentPrice,
                    exitTime: currentCandle.time,
                    exitReason: 'DRAWDOWN' as const,
                    pnl: finalPnl,
                    pnlPercent: (finalPnl / (pos.entryPrice * pos.size)) * 100,
                  };
                });

                setClosedTrades(prev => [...prev, ...closedList]);
                
                const totalClosedPnl = closedList.reduce((sum, p) => sum + p.pnl, 0);
                setAccount(pa => ({
                  ...pa,
                  balance: pa.balance + totalClosedPnl,
                  equity: pa.balance + totalClosedPnl,
                  maxEquity: Math.max(pa.maxEquity, pa.balance + totalClosedPnl),
                  maxDrawdownReached: true,
                  lossCount: pa.lossCount + closedList.length,
                  totalProfit: pa.totalProfit + totalClosedPnl,
                }));

                return [];
              });
            }, 0);
          } else {
            // Regularly update floating equity
            setTimeout(() => {
              setAccount(prev => {
                if (Math.abs(prev.equity - currentEquity) > 0.01 || Math.abs(prev.maxEquity - nextMaxEquity) > 0.01) {
                  return {
                    ...prev,
                    equity: currentEquity,
                    maxEquity: nextMaxEquity
                  };
                }
                return prev;
              });
            }, 0);
          }

          return nextPositions;
        });

        // 3. Evaluate entry rules (Only on closed candles to avoid repaint signals)
        if (isNewCandle) {
          // Check max concurrent active symbols count
          setSimulatorPositions((prevPositions) => {
            const activeSymbolsCount = Array.from(new Set(prevPositions.map(p => p.symbol))).length;
            if (activeSymbolsCount >= (riskSettings.maxConcurrentPositions || 3)) {
              return prevPositions;
            }

            // Cooldown check
            if (lastExitTimeRef.current && (currentCandle.time - lastExitTimeRef.current) < 3 * 5 * 60 * 1000) {
              return prevPositions;
            }

            const decision = evaluateStrategy(calculatedCandles, stratSettings);
            if (!decision.signal) return prevPositions;

            // Volatility protection check (ATR min)
            const atrValue = currentCandle.atr || (currentCandle.high - currentCandle.low) || 1.0;
            const atrPercent = (atrValue / currentPrice) * 100;
            const atrMin = riskSettings.volatilityAtrMin !== undefined ? riskSettings.volatilityAtrMin : 0.05;
            
            if (atrPercent < atrMin) {
              addLog(`Volatility Protection: Signal skipped for MOCKUSDT due to ATR ${atrPercent.toFixed(3)}% < minimum ${atrMin}%`, 'warning');
              return prevPositions;
            }

            const slDistance = atrValue * riskSettings.atrMultiplier;
            const maxLossUsd = account.balance * (riskSettings.riskPercent / 100);
            let size = maxLossUsd / slDistance;

            const totalCapitalRequired = size * currentPrice;
            const maxAllowedExposure = account.balance * riskSettings.leverage;
            if (totalCapitalRequired > maxAllowedExposure) {
              size = maxAllowedExposure / currentPrice;
            }

            addLog(`🔔 Trade Signal triggered: ${decision.reason}`, 'trade');

            if (riskSettings.hedgedDualExecutionEnabled) {
              const primaryId = `sim_pri_${Date.now()}`;
              const hedgeId = `sim_hdg_${Date.now()}`;
              
              const primaryType = decision.signal === 'BUY' ? 'LONG' : 'SHORT';
              const hedgeType = primaryType === 'LONG' ? 'SHORT' : 'LONG';

              const halfUsdt = account.balance * 0.5;
              const primaryLev = riskSettings.leverage;
              const hedgeLev = Math.max(1, Math.round(riskSettings.leverage / 2));
              
              const sizePrimary = (halfUsdt * primaryLev) / currentPrice;
              const sizeHedge = (halfUsdt * hedgeLev) / currentPrice;

              let primarySl = primaryType === 'LONG' ? currentPrice - slDistance : currentPrice + slDistance;
              let primaryTp = primaryType === 'LONG' ? currentPrice + slDistance * riskSettings.riskRewardRatio : currentPrice - slDistance * riskSettings.riskRewardRatio;

              const primaryPos: Position = {
                id: primaryId,
                type: primaryType as any,
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

              let hedgeSl = hedgeType === 'LONG' ? currentPrice - slDistance : currentPrice + slDistance;
              let hedgeTp = hedgeType === 'LONG' ? currentPrice + slDistance * riskSettings.riskRewardRatio : currentPrice - slDistance * riskSettings.riskRewardRatio;

              const hedgePos: Position = {
                id: hedgeId,
                type: hedgeType as any,
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

              addLog(`📥 Executed Simulator Hedged Dual Entry. Primary: ${primaryType} (${primaryLev}X, Size: ${sizePrimary.toFixed(4)}), Hedge: ${hedgeType} (${hedgeLev}X, Size: ${sizeHedge.toFixed(4)}).`, 'info');
              return [...prevPositions, primaryPos, hedgePos];
            } else {
              let slPrice = decision.signal === 'BUY' ? currentPrice - slDistance : currentPrice + slDistance;
              let tpPrice = decision.signal === 'BUY' ? currentPrice + slDistance * riskSettings.riskRewardRatio : currentPrice - slDistance * riskSettings.riskRewardRatio;

              const singlePos: Position = {
                id: `sim_single_${Date.now()}`,
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

              addLog(`📥 Executed Simulator Single Position Entry: ${singlePos.type}.`, 'info');
              return [...prevPositions, singlePos];
            }
          });
        }

        return calculatedCandles;
      });
    }, 1000);

    return () => {
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    };
  }, [botActive, stratSettings, riskSettings, simulatorPositions]);

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

    const targetSymbol = symbolToClose || 'MOCKUSDT';
    
    setSimulatorPositions((prevPositions) => {
      const remaining = [];
      const currentPrice = candles[candles.length - 1].close;

      for (const pos of prevPositions) {
        if (pos.symbol === targetSymbol || targetSymbol === 'MOCKUSDT') {
          const finalPnl = pos.type === 'LONG'
            ? (currentPrice - pos.entryPrice) * pos.size * pos.leverage
            : (pos.entryPrice - currentPrice) * pos.size * pos.leverage;

          const closedPos: Position = {
            ...pos,
            status: 'CLOSED',
            exitPrice: currentPrice,
            exitTime: Date.now(),
            exitReason: 'MANUAL',
            pnl: finalPnl,
            pnlPercent: (finalPnl / (pos.entryPrice * pos.size)) * 100,
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
          addLog(`⚠️ POSITION CLOSED MANUALLY at $${currentPrice.toFixed(2)}. PnL: ${finalPnl >= 0 ? '+' : ''}$${finalPnl.toFixed(2)}.`, 'warning');
        } else {
          remaining.push(pos);
        }
      }
      return remaining;
    });

    lastExitTimeRef.current = Date.now();
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

  const currentActivePosition = botMode === 'EXCHANGE_LIVE'
    ? (allPositions.length > 0 ? allPositions[0] : null)
    : (simulatorPositions.length > 0 ? simulatorPositions[0] : null);

  const currentAllPositions = botMode === 'EXCHANGE_LIVE'
    ? allPositions
    : simulatorPositions;

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
              activePosition={currentActivePosition}
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
                activePosition={currentActivePosition}
                closedTrades={closedTrades}
                logs={logs}
                onClosePosition={handleManualClose}
                latestPrice={currentPrice}
                allPositions={currentAllPositions}
                evaluationStates={evaluationStates}
                accountBalance={account.balance}
                exchangeStatus={exchangeStatus}
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
