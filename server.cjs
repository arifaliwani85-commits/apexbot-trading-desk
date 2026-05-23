const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const ccxt = require('ccxt');

// Load environment variables
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;

// --- In-Memory State ---
let exchangeInstance = null;
let connectionStatus = 'DISCONNECTED'; // DISCONNECTED, CONNECTED, ERROR
let exchangeConfig = {
  exchangeId: 'binance',
  apiKey: '',
  apiSecret: '',
  isTestnet: true,
};

let botActive = false;
let currentSymbol = 'BTC/USDT'; // Currently selected symbol for chart views
let activeSymbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT']; // basket of symbols to trade
let activePositions = {}; // symbol -> position map
let closedTrades = [];
let botLogs = [];

let lastTickPrices = {}; // symbol -> price map
let candlesMap = {};     // symbol -> 15m candles list

let dailyStartEquity = null;
let lastCircuitBreakerCheckDate = '';
let circuitBreakerTriggered = false;

let stratSettings = {
  strategyType: 'TREND_FOLLOWING',
  emaShortPeriod: 20,
  emaLongPeriod: 50,
  emaTrendPeriod: 200,
  rsiPeriod: 14,
  rsiOverbought: 65,
  rsiOversold: 30,
  atrPeriod: 14,
  adxThreshold: 25,
  useMultiTimeframe: true,
};

let riskSettings = {
  riskPercent: 1.0,
  riskRewardRatio: 2.0,
  atrMultiplier: 2.0,
  trailingStopEnabled: true,
  trailingStopTrigger: 1.2,
  maxDailyDrawdown: 5.0,
  leverage: 1,
  maxConcurrentPositions: 3,
  partialTakeProfitEnabled: true,
};

// Add server log message helper
function addLog(text, type = 'info') {
  const log = {
    id: Math.random().toString(),
    timestamp: Date.now(),
    type,
    text,
  };
  botLogs.push(log);
  if (botLogs.length > 200) botLogs.shift();
  console.log(`[${new Date().toISOString()}] [${type.toUpperCase()}] ${text}`);
}

// Initial System Log
addLog('Local backend server starting...', 'info');

// --- Math & Indicator Helper Functions (CommonJS version) ---

function calculateEMA(prices, period) {
  const ema = [];
  if (prices.length === 0) return ema;

  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < Math.min(period, prices.length); i++) {
    sum += prices[i];
  }
  let prevEma = sum / Math.min(period, prices.length);

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

function calculateSMA(prices, period) {
  const sma = [];
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

function calculateStandardDeviation(values, mean) {
  const sumOfSquares = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0);
  return Math.sqrt(sumOfSquares / values.length);
}

function calculateBollingerBands(prices, period = 20, multiplier = 2) {
  const middle = calculateSMA(prices, period);
  const upper = [];
  const lower = [];

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

function calculateRSI(prices, period = 14) {
  const rsi = [];
  if (prices.length <= period) {
    return Array(prices.length).fill(NaN);
  }

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }

  avgGain /= period;
  avgLoss /= period;

  for (let i = 0; i < period; i++) rsi.push(NaN);
  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) rsi.push(100);
    else rsi.push(100 - 100 / (1 + avgGain / avgLoss));
  }
  return rsi;
}

function calculateATR(candlesList, period = 14) {
  const atr = [];
  if (candlesList.length === 0) return atr;

  const tr = [];
  tr.push(candlesList[0].high - candlesList[0].low);
  for (let i = 1; i < candlesList.length; i++) {
    const highLow = candlesList[i].high - candlesList[i].low;
    const highClose = Math.abs(candlesList[i].high - candlesList[i - 1].close);
    const lowClose = Math.abs(candlesList[i].low - candlesList[i - 1].close);
    tr.push(Math.max(highLow, highClose, lowClose));
  }

  let sum = 0;
  for (let i = 0; i < Math.min(period, tr.length); i++) {
    sum += tr[i];
  }
  let prevAtr = sum / Math.min(period, tr.length);

  for (let i = 0; i < candlesList.length; i++) {
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
function calculateADX(candlesList, period = 14) {
  const adx = Array(candlesList.length).fill(NaN);
  if (candlesList.length <= period * 2) return adx;

  const tr = [0];
  const plusDM = [0];
  const minusDM = [0];

  for (let i = 1; i < candlesList.length; i++) {
    const prev = candlesList[i - 1];
    const curr = candlesList[i];

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

  let smoothedTR = 0;
  let smoothedPlusDM = 0;
  let smoothedMinusDM = 0;

  for (let i = 1; i <= period; i++) {
    smoothedTR += tr[i];
    smoothedPlusDM += plusDM[i];
    smoothedMinusDM += minusDM[i];
  }

  const plusDI = Array(candlesList.length).fill(NaN);
  const minusDI = Array(candlesList.length).fill(NaN);
  const dx = Array(candlesList.length).fill(NaN);

  plusDI[period] = smoothedTR === 0 ? 0 : 100 * (smoothedPlusDM / smoothedTR);
  minusDI[period] = smoothedTR === 0 ? 0 : 100 * (smoothedMinusDM / smoothedTR);

  let diDiff = Math.abs(plusDI[period] - minusDI[period]);
  let diSum = plusDI[period] + minusDI[period];
  dx[period] = diSum === 0 ? 0 : 100 * (diDiff / diSum);

  for (let i = period + 1; i < candlesList.length; i++) {
    smoothedTR = smoothedTR - (smoothedTR / period) + tr[i];
    smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM / period) + plusDM[i];
    smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM / period) + minusDM[i];

    plusDI[i] = smoothedTR === 0 ? 0 : 100 * (smoothedPlusDM / smoothedTR);
    minusDI[i] = smoothedTR === 0 ? 0 : 100 * (smoothedMinusDM / smoothedTR);

    diDiff = Math.abs(plusDI[i] - minusDI[i]);
    diSum = plusDI[i] + minusDI[i];
    dx[i] = diSum === 0 ? 0 : 100 * (diDiff / diSum);
  }

  let dxSum = 0;
  for (let i = period; i < period * 2; i++) {
    dxSum += dx[i];
  }
  let smoothedDX = dxSum / period;
  adx[period * 2 - 1] = smoothedDX;

  for (let i = period * 2; i < candlesList.length; i++) {
    smoothedDX = smoothedDX - (smoothedDX / period) + dx[i];
    adx[i] = smoothedDX;
  }

  return adx;
}

// Volume Weighted Average Price (VWAP) with daily reset
function calculateVWAP(candlesList) {
  const vwap = [];
  let cumVolume = 0;
  let cumPriceVolume = 0;
  let prevDay = null;

  for (let i = 0; i < candlesList.length; i++) {
    const candle = candlesList[i];
    const date = new Date(candle.time);
    const day = date.getUTCDate();

    if (prevDay !== null && day !== prevDay) {
      cumVolume = 0;
      cumPriceVolume = 0;
    }
    prevDay = day;

    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    const vol = candle.volume || 1;
    cumVolume += vol;
    cumPriceVolume += typicalPrice * vol;

    vwap.push(cumPriceVolume / (cumVolume || 1));
  }

  return vwap;
}

function computeIndicators(candlesList) {
  const closes = candlesList.map((c) => c.close);
  const emaShort = calculateEMA(closes, stratSettings.emaShortPeriod);
  const emaLong = calculateEMA(closes, stratSettings.emaLongPeriod);
  const emaTrend = calculateEMA(closes, stratSettings.emaTrendPeriod);
  const bb = calculateBollingerBands(closes, 20, 2);
  const rsi = calculateRSI(closes, stratSettings.rsiPeriod);
  const atr = calculateATR(candlesList, stratSettings.atrPeriod);
  const adx = calculateADX(candlesList, 14);
  const vwap = calculateVWAP(candlesList);

  return candlesList.map((candle, i) => ({
    ...candle,
    ema20: emaShort[i],
    ema50: emaLong[i],
    ema200: emaTrend[i],
    bbUpper: bb.upper[i],
    bbMiddle: bb.middle[i],
    bbLower: bb.lower[i],
    rsi: rsi[i],
    atr: atr[i],
    adx: adx[i],
    vwap: vwap[i],
  }));
}

// Evaluate Strategy Entry Signals
function evaluateStrategyRules(candlesList) {
  const len = candlesList.length;
  if (len < 5) return { signal: null };

  const current = candlesList[len - 1];
  const previous = candlesList[len - 2];

  if (stratSettings.strategyType === 'TREND_FOLLOWING') {
    const { ema20, ema50, ema200, rsi } = current;
    const { ema20: emaShortPrev, ema50: emaLongPrev } = previous;
    
    if (!ema20 || !ema50 || !ema200 || !emaShortPrev || !emaLongPrev || !rsi) return { signal: null };

    // Golden Cross
    if (emaShortPrev <= emaLongPrev && ema20 > ema50) {
      if (current.close > ema200 && rsi < stratSettings.rsiOverbought) {
        return { signal: 'BUY', reason: 'EMA Golden Cross with RSI confirmation in an uptrend' };
      }
    }
    // Death Cross
    if (emaShortPrev >= emaLongPrev && ema20 < ema50) {
      if (current.close < ema200 && rsi > stratSettings.rsiOversold) {
        return { signal: 'SELL', reason: 'EMA Death Cross with RSI confirmation in a downtrend' };
      }
    }
  } else if (stratSettings.strategyType === 'MEAN_REVERSION') {
    const { bbLower, bbUpper, rsi } = current;
    const { bbLower: bbLowerPrev, bbUpper: bbUpperPrev } = previous;
    
    if (!bbLower || !bbUpper || !bbLowerPrev || !bbUpperPrev || !rsi) return { signal: null };

    if ((current.close <= bbLower || previous.close <= bbLowerPrev) && rsi <= stratSettings.rsiOversold) {
      return { signal: 'BUY', reason: 'Price rejected Lower BB with RSI oversold' };
    }
    if ((current.close >= bbUpper || previous.close >= bbUpperPrev) && rsi >= stratSettings.rsiOverbought) {
      return { signal: 'SELL', reason: 'Price rejected Upper BB with RSI overbought' };
    }
  } else if (stratSettings.strategyType === 'MOMENTUM_BREAKOUT') {
    const lookback = 20;
    if (len <= lookback) return { signal: null };

    const slice = candlesList.slice(len - 1 - lookback, len - 1);
    let highestHigh = -Infinity;
    let lowestLow = Infinity;
    let totalVol = 0;
    for (const c of slice) {
      if (c.high > highestHigh) highestHigh = c.high;
      if (c.low < lowestLow) lowestLow = c.low;
      totalVol += c.volume;
    }
    const avgVol = totalVol / lookback;
    
    const { atr } = current;
    const { atr: atrPrev } = previous;
    if (!atr || !atrPrev) return { signal: null };

    if (current.close > highestHigh && current.volume > avgVol * 1.3 && atr > atrPrev) {
      return { signal: 'BUY', reason: 'Price broke above 20-period high with volume expansion' };
    }
    if (current.close < lowestLow && current.volume > avgVol * 1.3 && atr > atrPrev) {
      return { signal: 'SELL', reason: 'Price broke below 20-period low with volume expansion' };
    }
  }

  return { signal: null };
}

// --- Initialize Saved Connection on Startup ---
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    if (process.env.EXCHANGE_API_KEY && process.env.EXCHANGE_API_SECRET) {
      exchangeConfig = {
        exchangeId: process.env.EXCHANGE_ID || 'binance',
        apiKey: process.env.EXCHANGE_API_KEY,
        apiSecret: process.env.EXCHANGE_API_SECRET,
        isTestnet: process.env.EXCHANGE_IS_TESTNET === 'true',
      };
      
      const config = {
        apiKey: exchangeConfig.apiKey,
        secret: exchangeConfig.apiSecret,
        enableRateLimit: true,
      };

      const exchangeClass = ccxt[exchangeConfig.exchangeId];
      if (exchangeClass) {
        exchangeInstance = new exchangeClass(config);
        if (exchangeConfig.isTestnet && exchangeInstance.setSandboxMode) {
          exchangeInstance.setSandboxMode(true);
        }
        connectionStatus = 'CONNECTED';
        addLog(`Auto-loaded credentials. Connected to ${exchangeConfig.exchangeId.toUpperCase()} (${exchangeConfig.isTestnet ? 'TESTNET' : 'MAINNET'}).`, 'success');
      }
    }
  }
} catch (e) {
  console.error('Error auto-loading API keys:', e);
}

// --- Express Route Handlers ---

// Route to connect to Exchange
app.post('/api/connect', async (req, res) => {
  const { exchangeId, apiKey, apiSecret, isTestnet } = req.body;
  addLog(`Attempting to connect to ${exchangeId.toUpperCase()}...`, 'info');

  try {
    const exchangeClass = ccxt[exchangeId];
    if (!exchangeClass) {
      throw new Error(`Exchange ${exchangeId} is not supported by CCXT.`);
    }

    const testExchange = new exchangeClass({
      apiKey,
      secret: apiSecret,
      enableRateLimit: true,
    });

    if (isTestnet && testExchange.setSandboxMode) {
      testExchange.setSandboxMode(true);
    }

    // Fetch balance to validate the API key works
    const balanceData = await testExchange.fetchBalance();
    
    // Success: Update state
    exchangeInstance = testExchange;
    connectionStatus = 'CONNECTED';
    exchangeConfig = { exchangeId, apiKey, apiSecret, isTestnet };
    circuitBreakerTriggered = false; // Reset circuit breaker on successful connection

    // Write securely to local .env file
    const envContent = `EXCHANGE_ID=${exchangeId}
EXCHANGE_API_KEY=${apiKey}
EXCHANGE_API_SECRET=${apiSecret}
EXCHANGE_IS_TESTNET=${isTestnet}`;
    
    fs.writeFileSync(path.join(__dirname, '.env'), envContent);

    addLog(`Connected successfully to ${exchangeId.toUpperCase()}! Balance fetched.`, 'success');
    
    res.json({
      success: true,
      status: connectionStatus,
      balance: balanceData.total.USDT || balanceData.total.BUSD || 0,
    });
  } catch (err) {
    connectionStatus = 'ERROR';
    let msg = err.message || '';
    let friendlyError = msg;
    
    if (exchangeId === 'bybit') {
      if (msg.includes('10003') || msg.toLowerCase().includes('api key is invalid')) {
        friendlyError = `Bybit API Key Invalid (Error 10003). Check that you are connecting to the correct environment (Testnet requires "Use Testnet Sandbox" checked, Mainnet requires it unchecked) and verify your key characters.`;
      } else if (msg.includes('10005') || msg.toLowerCase().includes('permission')) {
        friendlyError = `Bybit Permission Error. Ensure your API Key has "Trade" or "Unified Account" permissions enabled in your Bybit API settings.`;
      }
    } else if (exchangeId === 'binance') {
      if (msg.toLowerCase().includes('api key') || msg.toLowerCase().includes('invalid')) {
        friendlyError = `Binance API Key Invalid. Check your credentials and verify the Testnet checkbox matching your keys.`;
      }
    }
    
    addLog(`Connection failed: ${friendlyError}`, 'danger');
    res.status(400).json({ success: false, error: friendlyError });
  }
});

// Route to disconnect from exchange and clear keys
app.post('/api/disconnect', (req, res) => {
  exchangeInstance = null;
  connectionStatus = 'DISCONNECTED';
  exchangeConfig = { exchangeId: 'binance', apiKey: '', apiSecret: '', isTestnet: true };
  botActive = false;
  
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      fs.unlinkSync(envPath); // Deletes .env file securely
    }
  } catch (e) {
    console.error('Error clearing .env credentials:', e);
  }

  addLog('Disconnected from exchange. API credentials cleared.', 'warning');
  res.json({ success: true });
});

// Route to get Bot status & balance
app.get('/api/status', async (req, res) => {
  const clientSymbol = req.query.symbol;
  if (clientSymbol && activeSymbols.includes(clientSymbol)) {
    currentSymbol = clientSymbol;
  }

  let exchangeBalance = 0;
  
  if (exchangeInstance && connectionStatus === 'CONNECTED') {
    try {
      const balanceData = await exchangeInstance.fetchBalance();
      exchangeBalance = balanceData.total.USDT || balanceData.total.BUSD || 0;
    } catch (e) {
      addLog(`Failed to fetch live balance: ${e.message}`, 'warning');
    }
  }

  // Calculate daily drawdown based on equity vs start balance
  let netUnrealizedPnL = 0;
  Object.values(activePositions).forEach((pos) => {
    if (pos) {
      const price = lastTickPrices[pos.symbol] || pos.entryPrice;
      const diff = pos.type === 'LONG' ? price - pos.entryPrice : pos.entryPrice - price;
      netUnrealizedPnL += diff * pos.size * pos.leverage;
    }
  });

  const currentEquity = exchangeBalance + netUnrealizedPnL;
  if (dailyStartEquity === null && exchangeBalance > 0) {
    dailyStartEquity = exchangeBalance;
  }

  let dailyDrawdownPercent = 0;
  if (dailyStartEquity > 0) {
    const pnl = currentEquity - dailyStartEquity;
    if (pnl < 0) {
      dailyDrawdownPercent = (Math.abs(pnl) / dailyStartEquity) * 100;
    }
  }

  res.json({
    connected: connectionStatus === 'CONNECTED',
    exchangeId: exchangeConfig.exchangeId,
    isTestnet: exchangeConfig.isTestnet,
    balance: exchangeBalance,
    equity: currentEquity,
    botActive,
    symbol: currentSymbol,
    activeSymbols,
    activePosition: activePositions[currentSymbol] || null,
    allPositions: Object.values(activePositions).filter(Boolean),
    candles: (candlesMap[currentSymbol] || []).slice(-100),
    dailyDrawdownPercent,
    dailyStartEquity,
    circuitBreakerTriggered,
  });
});

// Route to get bot logs
app.get('/api/logs', (req, res) => {
  res.json({ logs: botLogs });
});

// Route to close position manually on the exchange
app.post('/api/close-position', async (req, res) => {
  const targetSym = req.body.symbol || currentSymbol;
  const pos = activePositions[targetSym];
  if (!pos) {
    return res.status(400).json({ success: false, error: `No active position open for ${targetSym}.` });
  }

  addLog(`Request received to manually market close position for ${targetSym}...`, 'warning');
  try {
    await executeCloseOrder(targetSym, 'MANUAL');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route to toggle Live Trading loop
app.post('/api/toggle-bot', (req, res) => {
  const { active, settings, risk, symbol, activeSymbols: clientActiveSymbols } = req.body;
  
  botActive = active;
  if (settings) stratSettings = settings;
  if (risk) riskSettings = risk;
  if (symbol) currentSymbol = symbol;
  if (clientActiveSymbols && Array.isArray(clientActiveSymbols)) {
    activeSymbols = clientActiveSymbols;
  }

  if (botActive) {
    if (circuitBreakerTriggered) {
      circuitBreakerTriggered = false; // Reset circuit breaker
      dailyStartEquity = null;
      addLog('Daily Drawdown Circuit Breaker reset manually by starting the bot.', 'info');
    }
    addLog(`Automated Live Trading loop ACTIVATED for: ${activeSymbols.join(', ')}.`, 'warning');
    if (!exchangeInstance) {
      addLog('Liveness Warning: Exchange client is not connected! Trading is paused.', 'danger');
    }
  } else {
    addLog('Automated Live Trading loop DEACTIVATED.', 'warning');
  }

  res.json({ success: true, botActive });
});

// --- HELPER EXECUTION ROUTINES ---

async function executeCloseOrder(symbol, reason, customSize = null) {
  const pos = activePositions[symbol];
  if (!pos) return;

  const closeSide = pos.type === 'LONG' ? 'sell' : 'buy';
  const sizeToClose = customSize !== null ? customSize : pos.size;
  const tickerPrice = lastTickPrices[symbol] || pos.entryPrice;

  addLog(`Sending Close Order (${closeSide.toUpperCase()}) on Exchange for ${sizeToClose.toFixed(4)} ${symbol.split('/')[0]}...`, 'info');

  try {
    let fillPrice = tickerPrice;

    if (exchangeInstance) {
      // Place real market order on exchange to close
      const order = await exchangeInstance.createMarketOrder(symbol, closeSide, sizeToClose);
      fillPrice = order.price || order.average || tickerPrice;
      addLog(`Exchange Fill success for ${symbol}. Closed size ${sizeToClose.toFixed(4)} at average price $${fillPrice}.`, 'success');
    } else {
      addLog(`Simulation Note: Exchange client disconnected. Filled closing order locally at ticker price.`, 'warning');
    }

    const pnl = pos.type === 'LONG'
      ? (fillPrice - pos.entryPrice) * sizeToClose * pos.leverage
      : (pos.entryPrice - fillPrice) * sizeToClose * pos.leverage;

    if (customSize !== null && customSize < pos.size) {
      // Partial Scale Out
      pos.size -= customSize;
      pos.halfClosed = true;
      addLog(`Partial scale-out completed. Secured $${pnl.toFixed(2)} profit.`, 'success');
    } else {
      // Full Close
      const closedPos = {
        ...pos,
        size: sizeToClose,
        status: 'CLOSED',
        exitPrice: fillPrice,
        exitTime: Date.now(),
        exitReason: reason,
        pnl,
        pnlPercent: (pnl / (pos.entryPrice * sizeToClose)) * 100,
      };

      closedTrades.push(closedPos);
      activePositions[symbol] = null;

      const summaryMsg = pnl >= 0
        ? `📈 Trade Closed [${reason}] for ${symbol}: Profit: +$${pnl.toFixed(2)} (${closedPos.pnlPercent.toFixed(2)}%)`
        : `📉 Trade Closed [${reason}] for ${symbol}: Loss: -$${Math.abs(pnl).toFixed(2)} (${closedPos.pnlPercent.toFixed(2)}%)`;

      addLog(summaryMsg, pnl >= 0 ? 'success' : 'danger');
    }
  } catch (err) {
    addLog(`Failed to close position on exchange for ${symbol}: ${err.message}`, 'danger');
    throw err;
  }
}

// Sleep helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Background Execution Loop (Polling Exchange) ---
setInterval(async () => {
  if (!exchangeInstance || connectionStatus !== 'CONNECTED') return;

  try {
    // 1. UTC Midnight circuit breaker reset check
    const now = new Date();
    const todayStr = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;

    const balanceData = await exchangeInstance.fetchBalance();
    const exchangeBalance = balanceData.total.USDT || balanceData.total.BUSD || 0;

    if (lastCircuitBreakerCheckDate === '' || todayStr !== lastCircuitBreakerCheckDate) {
      dailyStartEquity = exchangeBalance;
      lastCircuitBreakerCheckDate = todayStr;
      circuitBreakerTriggered = false;
      addLog(`UTC Midnight Reset. Active equity balance: $${dailyStartEquity.toFixed(2)} USDT.`, 'info');
    }

    // 2. Compute current drawdown
    let netUnrealizedPnL = 0;
    Object.values(activePositions).forEach((pos) => {
      if (pos) {
        const price = lastTickPrices[pos.symbol] || pos.entryPrice;
        const diff = pos.type === 'LONG' ? price - pos.entryPrice : pos.entryPrice - price;
        netUnrealizedPnL += diff * pos.size * pos.leverage;
      }
    });

    const currentEquity = exchangeBalance + netUnrealizedPnL;
    let drawdownPercent = 0;
    if (dailyStartEquity && dailyStartEquity > 0) {
      const pnl = currentEquity - dailyStartEquity;
      if (pnl < 0) {
        drawdownPercent = (Math.abs(pnl) / dailyStartEquity) * 100;
      }
    }

    // Circuit Breaker activation
    if (drawdownPercent >= riskSettings.maxDailyDrawdown && !circuitBreakerTriggered) {
      circuitBreakerTriggered = true;
      botActive = false;
      addLog(`[CRITICAL] Daily Max Drawdown limit (${riskSettings.maxDailyDrawdown}%) hit! (Current: -${drawdownPercent.toFixed(2)}%). Triggering Emergency Circuit Breaker.`, 'danger');

      // Close all active positions
      for (const sym of activeSymbols) {
        if (activePositions[sym]) {
          addLog(`Circuit Breaker: Market closing position for ${sym}...`, 'warning');
          await executeCloseOrder(sym, 'DRAWDOWN');
        }
      }
      return;
    }

    if (circuitBreakerTriggered || !botActive) return;

    // 3. Process portfolio symbols sequentially (respect rate limits)
    for (const symbol of activeSymbols) {
      try {
        const timeframe = '15m';
        const ohlcv = await exchangeInstance.fetchOHLCV(symbol, timeframe, undefined, 100);

        const fetchedCandles = ohlcv.map((c) => ({
          time: c[0],
          open: c[1],
          high: c[2],
          low: c[3],
          close: c[4],
          volume: c[5],
        }));

        const calculatedCandles = computeIndicators(fetchedCandles);
        candlesMap[symbol] = calculatedCandles;
        const latestCandle = calculatedCandles[calculatedCandles.length - 1];
        const tickerPrice = latestCandle.close;
        lastTickPrices[symbol] = tickerPrice;

        // If this is the chart symbol, make it available globally
        if (symbol === currentSymbol) {
          candles = calculatedCandles;
        }

        // Check active position updates
        const pos = activePositions[symbol];
        if (pos) {
          // Update peak/valley
          if (pos.type === 'LONG') {
            pos.maxObservedPrice = Math.max(pos.maxObservedPrice || pos.entryPrice, tickerPrice);
          } else {
            pos.minObservedPrice = Math.min(pos.minObservedPrice || pos.entryPrice, tickerPrice);
          }

          // Partial scale out check
          if (riskSettings.partialTakeProfitEnabled && !pos.halfClosed) {
            let target1Hit = false;
            if (pos.type === 'LONG' && tickerPrice >= pos.target1Price) {
              target1Hit = true;
            } else if (pos.type === 'SHORT' && tickerPrice <= pos.target1Price) {
              target1Hit = true;
            }

            if (target1Hit) {
              addLog(`🎯 Target 1 (1.5R) hit for ${symbol} at $${pos.target1Price.toFixed(2)}. Closing 50% size.`, 'success');
              await executeCloseOrder(symbol, 'TP', pos.size / 2);
              
              // Move stop loss to entry + 20% risk offset
              const slDistance = Math.abs(pos.entryPrice - pos.stopLoss);
              if (pos.type === 'LONG') {
                pos.stopLoss = pos.entryPrice + slDistance * 0.2;
              } else {
                pos.stopLoss = pos.entryPrice - slDistance * 0.2;
              }
              addLog(`Locked in profit. Adjusted Stop Loss for remaining 50% position of ${symbol} to $${pos.stopLoss.toFixed(2)} (Risk-free).`, 'info');
            }
          }

          // Trailing stop checks
          if (riskSettings.trailingStopEnabled && !pos.halfClosed) {
            const slDistance = Math.abs(pos.entryPrice - pos.stopLoss);

            if (pos.type === 'LONG') {
              const trigger = pos.entryPrice + slDistance * riskSettings.trailingStopTrigger;
              if (pos.maxObservedPrice > trigger) {
                const newSL = pos.entryPrice + slDistance * 0.2;
                if (newSL > pos.stopLoss) {
                  pos.stopLoss = newSL;
                  addLog(`Trailing Stop adjusted higher for LONG ${symbol} to $${newSL.toFixed(2)}.`, 'info');
                }
              }
            } else {
              const trigger = pos.entryPrice - slDistance * riskSettings.trailingStopTrigger;
              if (pos.minObservedPrice < trigger) {
                const newSL = pos.entryPrice - slDistance * 0.2;
                if (newSL < pos.stopLoss) {
                  pos.stopLoss = newSL;
                  addLog(`Trailing Stop adjusted lower for SHORT ${symbol} to $${newSL.toFixed(2)}.`, 'info');
                }
              }
            }
          }

          // Exit check
          let hitExit = false;
          let exitReason = null;

          if (pos.type === 'LONG') {
            if (tickerPrice <= pos.stopLoss) {
              hitExit = true;
              exitReason = pos.halfClosed || (riskSettings.trailingStopEnabled && pos.stopLoss > pos.entryPrice) ? 'TRAILING_STOP' : 'SL';
            } else if (tickerPrice >= pos.takeProfit) {
              hitExit = true;
              exitReason = 'TP';
            }
          } else {
            if (tickerPrice >= pos.stopLoss) {
              hitExit = true;
              exitReason = pos.halfClosed || (riskSettings.trailingStopEnabled && pos.stopLoss < pos.entryPrice) ? 'TRAILING_STOP' : 'SL';
            } else if (tickerPrice <= pos.takeProfit) {
              hitExit = true;
              exitReason = 'TP';
            }
          }

          if (hitExit) {
            addLog(`Exit signal triggered for ${symbol}: Price ($${tickerPrice.toFixed(2)}) hit ${exitReason} limit (${exitReason === 'TP' ? pos.takeProfit.toFixed(2) : pos.stopLoss.toFixed(2)}). Closing...`, 'warning');
            await executeCloseOrder(symbol, exitReason);
          }
        }

        // Evaluate entries
        const openCount = Object.values(activePositions).filter(Boolean).length;
        if (!pos && openCount < riskSettings.maxConcurrentPositions) {
          const decision = evaluateStrategyRules(calculatedCandles);

          if (decision.signal) {
            let mtfAligned = true;

            // Check Multi-Timeframe Trend filter
            if (stratSettings.useMultiTimeframe) {
              try {
                const ohlcv4h = await exchangeInstance.fetchOHLCV(symbol, '4h', undefined, 50);
                const closes4h = ohlcv4h.map((c) => c[4]);
                const ema20_4h = calculateEMA(closes4h, 20);
                const ema50_4h = calculateEMA(closes4h, 50);

                const last20_4h = ema20_4h[ema20_4h.length - 1];
                const last50_4h = ema50_4h[ema50_4h.length - 1];

                if (decision.signal === 'BUY' && last20_4h < last50_4h) {
                  mtfAligned = false;
                  addLog(`Ignored BUY for ${symbol}: 4H Macro trend is bearish (4H EMA20 < 4H EMA50)`, 'info');
                } else if (decision.signal === 'SELL' && last20_4h > last50_4h) {
                  mtfAligned = false;
                  addLog(`Ignored SELL for ${symbol}: 4H Macro trend is bullish (4H EMA20 > 4H EMA50)`, 'info');
                }
              } catch (mtfErr) {
                addLog(`Failed to fetch 4H macro trend for ${symbol}: ${mtfErr.message}. Proceeding without filter.`, 'warning');
              }
            }

            if (mtfAligned) {
              addLog(`Signal detected for ${symbol}: ${decision.signal} (${decision.reason})`, 'warning');

              const atrValue = latestCandle.atr || (latestCandle.high - latestCandle.low) || 5.0;
              const slDistance = atrValue * riskSettings.atrMultiplier;

              let slPrice = 0;
              let tpPrice = 0;
              let target1Price = 0;

              if (decision.signal === 'BUY') {
                slPrice = tickerPrice - slDistance;
                tpPrice = tickerPrice + slDistance * riskSettings.riskRewardRatio;
                target1Price = tickerPrice + slDistance * 1.5;
              } else {
                slPrice = tickerPrice + slDistance;
                tpPrice = tickerPrice - slDistance * riskSettings.riskRewardRatio;
                target1Price = tickerPrice - slDistance * 1.5;
              }

              const maxLossUsd = exchangeBalance * (riskSettings.riskPercent / 100);
              let size = maxLossUsd / slDistance;

              const exposure = size * tickerPrice;
              const maxAllowed = exchangeBalance * riskSettings.leverage;
              if (exposure > maxAllowed) {
                size = maxAllowed / tickerPrice;
              }

              const tradeSide = decision.signal === 'BUY' ? 'buy' : 'sell';
              addLog(`Sending Entry Order (${tradeSide.toUpperCase()}) for ${size.toFixed(4)} ${symbol} to Exchange...`, 'info');

              const order = await exchangeInstance.createMarketOrder(symbol, tradeSide, size);
              const fillPrice = order.price || order.average || tickerPrice;

              activePositions[symbol] = {
                id: `live_${Date.now()}`,
                type: decision.signal === 'BUY' ? 'LONG' : 'SHORT',
                symbol: symbol,
                entryPrice: fillPrice,
                entryTime: Date.now(),
                size: size,
                leverage: riskSettings.leverage,
                stopLoss: parseFloat(slPrice.toFixed(2)),
                takeProfit: parseFloat(tpPrice.toFixed(2)),
                target1Price: parseFloat(target1Price.toFixed(2)),
                halfClosed: false,
                pnl: 0,
                pnlPercent: 0,
                status: 'OPEN',
                maxObservedPrice: fillPrice,
                minObservedPrice: fillPrice,
              };

              addLog(`📥 Executed live entry for ${symbol} at $${fillPrice}. SL: $${slPrice.toFixed(2)}, Target 1 (1.5R): $${target1Price.toFixed(2)}, Target 2 (${riskSettings.riskRewardRatio}R): $${tpPrice.toFixed(2)}`, 'success');
            }
          }
        }

        await sleep(500); // Prevent API rate limits
      } catch (symbolErr) {
        addLog(`Error processing ${symbol} polling: ${symbolErr.message}`, 'danger');
      }
    }
  } catch (err) {
    addLog(`Error in background live execution loop: ${err.message}`, 'danger');
  }
}, 10000); // Ticks every 10 seconds

// Serve static assets from Vite's built output in production
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Start backend server
app.listen(PORT, () => {
  addLog(`Express Server running on port ${PORT}. Ready to accept exchange API calls.`, 'success');
});
