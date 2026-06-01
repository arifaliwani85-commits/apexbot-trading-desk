export interface Candle {
  time: number; // timestamp in ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema20?: number;
  ema50?: number;
  ema200?: number;
  bbUpper?: number;
  bbMiddle?: number;
  bbLower?: number;
  rsi?: number;
  macd?: {
    macdLine: number;
    signalLine: number;
    histogram: number;
  };
  atr?: number;
  adx?: number;
  vwap?: number;
}

export type PositionType = 'LONG' | 'SHORT';

export interface Position {
  id: string;
  type: PositionType;
  symbol: string;
  entryPrice: number;
  entryTime: number;
  size: number; // size in base crypto units (e.g. BTC)
  leverage: number;
  stopLoss: number;
  takeProfit: number;
  pnl: number; // in USD
  pnlPercent: number;
  status: 'OPEN' | 'CLOSED';
  exitPrice?: number;
  exitTime?: number;
  exitReason?: 'SL' | 'TP' | 'MANUAL' | 'TRAILING_STOP' | 'DRAWDOWN';
  maxObservedPrice?: number; // for trailing stop tracking
  minObservedPrice?: number; // for trailing stop tracking (short positions)
  halfClosed?: boolean;      // whether 50% was closed at Target 1
  target1Price?: number;     // partial take profit level
  isHedgedPair?: boolean;
  hedgedRole?: 'PRIMARY' | 'HEDGE';
  hedgedScenario?: 'A' | 'B' | 'C' | 'NONE';
  pairedPositionId?: string;
  maxLeveragedPnL?: number;
}

export type StrategyType = 'TREND_FOLLOWING' | 'MEAN_REVERSION' | 'MOMENTUM_BREAKOUT' | 'HIGH_FREQUENCY_SCALPER' | 'NEWS_SENTIMENT_TRADING';

export interface StrategySettings {
  strategyType: StrategyType;
  emaShortPeriod: number;
  emaLongPeriod: number;
  emaTrendPeriod: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  atrPeriod: number;
  adxThreshold: number;
  useMultiTimeframe: boolean;
}

export interface RiskSettings {
  riskPercent: number; // 1 means 1% of balance
  riskRewardRatio: number; // e.g. 2 means 1:2 RRR
  atrMultiplier: number; // stop loss distance in ATRs
  trailingStopEnabled: boolean;
  trailingStopTrigger: number; // PnL ratio at which trailing stop triggers (e.g. at 1.0 RRR, SL moves to entry)
  maxDailyDrawdown: number; // percentage loss to stop trading
  leverage: number; // Leverage factor (default 1)
  maxConcurrentPositions: number; // maximum concurrent assets to trade
  partialTakeProfitEnabled: boolean; // close 50% at 1.5R and move SL to break-even
  hedgedDualExecutionEnabled: boolean;
  maxPortfolioDrawdown: number;
  volatilityAtrMin: number;
  volatilitySpreadMax: number;
}

export interface AccountState {
  balance: number;
  equity: number;
  initialBalance: number;
  dailyStartBalance: number;
  totalProfit: number;
  maxDrawdownReached: boolean;
  maxEquity: number;
  winCount: number;
  lossCount: number;
}

export interface LogMessage {
  id: string;
  timestamp: number;
  type: 'info' | 'success' | 'warning' | 'danger' | 'trade';
  text: string;
}

export interface BacktestResults {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netProfitPercent: number;
  netProfitUsd: number;
  maxDrawdownPercent: number;
  profitFactor: number;
  sharpeRatio: number;
  trades: Position[];
}

export interface EvaluationState {
  timestamp: number;
  strategy: string;
  regime: string;
  emaState: string;
  rsi: number;
  atr: number;
  adx: number;
  volume: number;
  status: 'WAITING_FOR_SIGNAL' | 'REJECTED' | 'EXECUTING' | 'ERROR' | 'COOLDOWN' | 'POSITION_OPEN';
  reason: string;
  calculatedSize?: number;
  minNotional?: number;
  payload?: any;
  error?: string;
}
