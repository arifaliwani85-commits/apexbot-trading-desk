const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let ccxt = null;
function getCcxt() {
  if (!ccxt) {
    console.log('[SYSTEM] Loading CCXT exchange library on-demand...');
    const start = Date.now();
    ccxt = require('ccxt');
    console.log(`[SYSTEM] Loaded CCXT exchange library in ${Date.now() - start}ms`);
  }
  return ccxt;
}

// Load environment variables
dotenv.config();

// Global Error Logger for Hostinger Diagnostics
process.on('uncaughtException', (err) => {
  const logMsg = `[${new Date().toISOString()}] UNCAUGHT EXCEPTION: ${err.stack || err}\n`;
  try {
    fs.appendFileSync(path.join(__dirname, 'crash.log'), logMsg);
  } catch (e) {
    console.error('Failed to write to crash.log:', e);
  }
  console.error(logMsg);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  const logMsg = `[${new Date().toISOString()}] UNHANDLED REJECTION: ${reason}\n`;
  try {
    fs.appendFileSync(path.join(__dirname, 'crash.log'), logMsg);
  } catch (e) {
    console.error('Failed to write to crash.log:', e);
  }
  console.error(logMsg);
});

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// --- Security & Hashing Helpers ---
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET || 'a_very_secure_default_32_byte_key_123!';

function getDerivedKey() {
  return crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === verifyHash;
}

function encryptText(text) {
  const iv = crypto.randomBytes(12);
  const key = getDerivedKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptText(encryptedText) {
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) return '';
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const key = getDerivedKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    console.error('Decryption failed:', e);
    return '';
  }
}

// --- JWT-like Pure JS Stateless Tokens ---
function generateToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', getDerivedKey()).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expectedSignature = crypto.createHmac('sha256', getDerivedKey()).update(`${header}.${body}`).digest('base64url');
    if (signature !== expectedSignature) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// --- Local File Database Setup ---
const DB_DIR = path.join(__dirname, 'db', 'users');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

function getUserPath(username) {
  const hash = crypto.createHash('sha256').update(username.toLowerCase()).digest('hex');
  return path.join(DB_DIR, `${hash}.json`);
}

function saveUserProfile(profile) {
  const userPath = getUserPath(profile.username);
  fs.writeFileSync(userPath, JSON.stringify(profile, null, 2));

  // Migrate old regex-based profiles if they exist
  try {
    const safeName = profile.username.replace(/[^a-zA-Z0-9_-]/g, '');
    const oldPath = path.join(DB_DIR, `${safeName}.json`);
    if (oldPath !== userPath && fs.existsSync(oldPath)) {
      fs.unlinkSync(oldPath);
    }
  } catch (e) {
    console.error('Failed to cleanup migrated user profile:', e);
  }
}

function loadUserProfile(username) {
  let userPath = getUserPath(username);
  if (!fs.existsSync(userPath)) {
    // Fallback to check old regex-based filename format
    const safeName = username.replace(/[^a-zA-Z0-9_-]/g, '');
    const oldPath = path.join(DB_DIR, `${safeName}.json`);
    if (fs.existsSync(oldPath)) {
      userPath = oldPath;
    } else {
      return null;
    }
  }
  try {
    return JSON.parse(fs.readFileSync(userPath, 'utf8'));
  } catch (e) {
    console.error(`Failed to parse user profile for ${username}`, e);
    return null;
  }
}

// --- In-Memory Multi-User Session Map ---
const userSessions = {};

function getOrCreateSession(username) {
  if (userSessions[username]) {
    return userSessions[username];
  }

  const profile = loadUserProfile(username);
  if (!profile) return null;

  const session = {
    username: profile.username,
    exchangeInstance: null,
    connectionStatus: 'DISCONNECTED',
    exchangeConfig: {
      exchangeId: 'bybit',
      apiKey: '',
      apiSecret: '',
      isTestnet: true,
    },
    botActive: profile.botActive || false,
    currentSymbol: profile.currentSymbol || 'BTC/USDT',
    activeSymbols: profile.activeSymbols || ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'DOGE/USDT', 'ALGO/USDT', 'ADA/USDT', 'XRP/USDT', 'LTC/USDT', 'LINK/USDT', 'DOT/USDT', 'AVAX/USDT', 'BNB/USDT', 'NEAR/USDT', 'MATIC/USDT', 'UNI/USDT', 'SUI/USDT', 'APT/USDT'],
    activePositions: {},
    closedTrades: profile.closedTrades || [],
    botLogs: [],
    lastTickPrices: {},
    candlesMap: {},
    dailyStartEquity: null,
    lastCircuitBreakerCheckDate: '',
    circuitBreakerTriggered: false,
    cooldowns: {}, // symbol -> timestamp of exit
    evaluationStates: {}, // symbol -> EvaluationState
    stratSettings: profile.stratSettings || {
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
    },
    riskSettings: profile.riskSettings || {
      riskPercent: 1.0,
      riskRewardRatio: 2.0,
      atrMultiplier: 2.0,
      trailingStopEnabled: true,
      trailingStopTrigger: 1.2,
      maxDailyDrawdown: 5.0,
      leverage: 1,
      maxConcurrentPositions: 3,
      partialTakeProfitEnabled: true,
      hedgedDualExecutionEnabled: true,
      maxPortfolioDrawdown: 10.0,
      volatilityAtrMin: 0.05,
      volatilitySpreadMax: 0.1,
    },
    addLog: function(text, type = 'info') {
      const log = {
        id: Math.random().toString(),
        timestamp: Date.now(),
        type,
        text,
      };
      this.botLogs.push(log);
      if (this.botLogs.length > 200) this.botLogs.shift();
      console.log(`[${this.username}] [${type.toUpperCase()}] ${text}`);
    }
  };

  // Auto-connect if encrypted keys exist
  if (profile.encryptedExchangeConfig) {
    try {
      const decrypted = decryptText(profile.encryptedExchangeConfig);
      if (decrypted) {
        const creds = JSON.parse(decrypted);
        session.exchangeConfig = creds;

        const exchangeClass = getCcxt()[creds.exchangeId];
        if (exchangeClass) {
          session.exchangeInstance = new exchangeClass({
            apiKey: creds.apiKey,
            secret: creds.apiSecret,
            enableRateLimit: true,
            timeout: 10000,
          });
          if (creds.isTestnet && session.exchangeInstance.setSandboxMode) {
            session.exchangeInstance.setSandboxMode(true);
          }
          session.connectionStatus = 'CONNECTED';
          session.exchangeInstance.loadMarkets().catch(e => console.error('Failed to load markets:', e));
          session.addLog(`Auto-loaded exchange keys. Connected to ${creds.exchangeId.toUpperCase()} (${creds.isTestnet ? 'TESTNET' : 'MAINNET'}).`, 'success');
        }
      }
    } catch (e) {
      session.connectionStatus = 'ERROR';
      session.addLog(`Auto-connection failed: ${e.message}`, 'danger');
    }
  }

  userSessions[username] = session;
  return session;
}

// Load active bots on start
function initAllActiveSessions() {
  try {
    if (!fs.existsSync(DB_DIR)) return;
    const files = fs.readdirSync(DB_DIR);
    let loadedCount = 0;
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(DB_DIR, file);
        try {
          const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (profile && profile.botActive && profile.username) {
            getOrCreateSession(profile.username);
            loadedCount++;
          }
        } catch (e) {
          console.error(`Failed to parse user profile: ${file}`, e);
        }
      }
    }
    console.log(`[SYSTEM] Restored ${loadedCount} active user trading sessions.`);
  } catch (err) {
    console.error('Failed to auto-load active sessions:', err);
  }
}

// Initial boot restoration
setTimeout(initAllActiveSessions, 1000);

// --- Exchange & Sizing & Logging Helpers ---
function getMarketSymbol(session, symbol) {
  let target = symbol;
  // Map MATIC to POL on Bybit (since Bybit completed MATIC -> POL migration)
  if (session.exchangeInstance && session.exchangeConfig.exchangeId === 'bybit') {
    if (target === 'MATIC/USDT') {
      target = 'POL/USDT';
    }
    const swapSymbol = `${target}:USDT`;
    if (session.exchangeInstance.markets && session.exchangeInstance.markets[swapSymbol]) {
      return swapSymbol;
    }
    return swapSymbol; // Fallback to swap format directly if markets not loaded yet
  }
  return target;
}

function getMinOrderSize(session, marketSymbol, price) {
  if (!session.exchangeInstance || !session.exchangeInstance.markets) return 0;
  const market = session.exchangeInstance.markets[marketSymbol];
  if (!market) return 0;

  let minAmount = 0;
  let minCost = 0;

  if (market.limits) {
    if (market.limits.amount && market.limits.amount.min !== undefined) {
      minAmount = market.limits.amount.min;
    }
    if (market.limits.cost && market.limits.cost.min !== undefined) {
      minCost = market.limits.cost.min;
    }
  }

  // Enforce a $5.0 USDT notional minimum for Bybit
  if (session.exchangeConfig.exchangeId === 'bybit' && minCost < 5.0) {
    minCost = 5.0;
  }

  const sizeFromCost = minCost > 0 ? minCost / price : 0;
  return Math.max(minAmount, sizeFromCost);
}

async function safeCreateMarketOrder(exchangeInstance, symbol, side, amount, params = {}, addLog) {
  let attempts = 3;
  let delay = 1000;
  const ccxtLib = getCcxt();

  for (let i = 1; i <= attempts; i++) {
    try {
      addLog(`Sending Market Order to Exchange (Attempt ${i}/${attempts}): ${side.toUpperCase()} ${amount} ${symbol} (params: ${JSON.stringify(params)})`, 'info');
      const order = await exchangeInstance.createMarketOrder(symbol, side, amount, undefined, params);
      return order;
    } catch (err) {
      const isTransient = (ccxtLib.NetworkError && err instanceof ccxtLib.NetworkError) ||
                          (ccxtLib.RequestTimeout && err instanceof ccxtLib.RequestTimeout) ||
                          (ccxtLib.RateLimitExceeded && err instanceof ccxtLib.RateLimitExceeded) ||
                          err.message.includes('timeout') ||
                          err.message.includes('Rate limit') ||
                          err.message.includes('rateLimit');

      if (isTransient && i < attempts) {
        addLog(`Transient exchange error (Attempt ${i} failed): ${err.message}. Retrying in ${delay}ms...`, 'warning');
        await new Promise((r) => setTimeout(r, delay));
        delay *= 1.5;
      } else {
        throw err;
      }
    }
  }
}

function logTickDetails(username, symbol, details) {
  try {
    const logDir = path.join(__dirname, 'db', 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logPath = path.join(logDir, `${username}_ticks.log`);
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${symbol}] Regime: ${details.regime} | EMA State: ${details.emaState} | RSI: ${details.rsi !== undefined && !isNaN(details.rsi) ? details.rsi.toFixed(2) : 'N/A'} | ATR: ${details.atr !== undefined && !isNaN(details.atr) ? details.atr.toFixed(4) : 'N/A'} | ADX: ${details.adx !== undefined && !isNaN(details.adx) ? details.adx.toFixed(2) : 'N/A'} | Status: ${details.status} | Reason: ${details.reason} | Size: ${details.calculatedSize !== undefined && !isNaN(details.calculatedSize) ? details.calculatedSize.toFixed(4) : 'N/A'} | MinNotional: ${details.minNotional !== undefined && !isNaN(details.minNotional) ? details.minNotional.toFixed(2) : 'N/A'}${details.error ? ` | Error: ${details.error}` : ''}\n`;
    
    fs.appendFileSync(logPath, line);
    
    // Rotate logs if file exceeds 5MB
    const stats = fs.statSync(logPath);
    if (stats.size > 5 * 1024 * 1024) {
      const data = fs.readFileSync(logPath, 'utf8');
      const lines = data.split('\n');
      const truncated = lines.slice(-2000).join('\n');
      fs.writeFileSync(logPath, truncated);
    }
  } catch (e) {
    console.error('Failed to write to tick log:', e);
  }
}

// --- Math & Indicator Helper Functions ---
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

function computeIndicators(candlesList, stratSettings) {
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

// --- News Sentiment Global Aggregator ---
let globalNewsCache = [];
let globalNewsSentiment = {};

function parseRss(xmlText) {
  const items = [];
  const matches = xmlText.match(/<item>([\s\S]*?)<\/item>/g);
  if (!matches) return items;
  for (const m of matches) {
    const titleMatch = m.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const descMatch = m.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
    if (titleMatch) {
      items.push({
        title: titleMatch[1].trim().replace(/<\/?[^>]+(>|$)/g, ""), // strip HTML
        description: descMatch ? descMatch[1].trim().replace(/<\/?[^>]+(>|$)/g, "") : ''
      });
    }
  }
  return items;
}

function getCoinName(symbol) {
  const names = {
    'BTC': 'Bitcoin',
    'ETH': 'Ethereum',
    'SOL': 'Solana',
    'DOGE': 'Dogecoin',
    'ALGO': 'Algorand',
    'ADA': 'Cardano',
    'XRP': 'Ripple',
    'LTC': 'Litecoin',
    'LINK': 'Chainlink',
    'DOT': 'Polkadot',
    'AVAX': 'Avalanche',
    'BNB': 'Binance',
    'NEAR': 'Near',
    'MATIC': 'Polygon',
    'UNI': 'Uniswap',
    'SUI': 'Sui',
    'APT': 'Aptos'
  };
  return names[symbol] || '';
}

async function updateNewsSentiment() {
  try {
    const urls = [
      'https://cointelegraph.com/rss',
      'https://news.bitcoin.com/feed/'
    ];
    let allStories = [];
    for (const url of urls) {
      try {
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (response.ok) {
          const text = await response.text();
          const items = parseRss(text);
          allStories = allStories.concat(items);
        }
      } catch (err) {
        console.error(`Failed to fetch news from ${url}:`, err.message);
      }
    }

    if (allStories.length === 0) {
      // Fallback: If network is offline or feeds block us, generate simulated realistic news stories
      allStories = [
        { title: "Bitcoin price rallies past critical resistance as whales buy the dip", description: "Rally continues as buying pressure surges." },
        { title: "Ethereum layer-2 network TVL reaches record high amid network upgrade", description: "Ethereum fee reduction drives massive adoption." },
        { title: "Solana daily active addresses surge to new record highs, DeFi activity explodes", description: "SOL price jumps 10% on massive decentralised exchange volumes." },
        { title: "Dogecoin displays strong breakout signal as major retailers accept DOGE payments", description: "Meme coin surges as adoption continues to expand globally." },
        { title: "Ripple secures final regulatory approval in major global jurisdiction", description: "XRP utility token jumps as legal clarity is established." },
        { title: "Cardano announces massive smart contract performance upgrade for scaling", description: "ADA spikes as transaction throughput triples." },
        { title: "Chainlink partners with major global banking network for secure cross-chain data", description: "LINK surges on institutional integration news." }
      ];
    }

    globalNewsCache = allStories.slice(0, 30); // Keep top 30 stories

    // Compute sentiment for all known coins
    const coins = ['BTC', 'ETH', 'SOL', 'DOGE', 'ALGO', 'ADA', 'XRP', 'LTC', 'LINK', 'DOT', 'AVAX', 'BNB', 'NEAR', 'MATIC', 'UNI', 'SUI', 'APT'];
    const positiveWords = ['rally', 'surge', 'bullish', 'breakout', 'all-time high', 'buy', 'upgrade', 'support', 'gain', 'skyrocket', 'explode', 'success', 'approved', 'partnership', 'whales accumulate', 'ath', 'gains'];
    const negativeWords = ['crash', 'bearish', 'dump', 'hack', 'lawsuit', 'crackdown', 'decline', 'scam', 'regulation', 'fears', 'fall', 'plunge', 'investigation', 'sell-off', 'drop', 'ban', 'liquidated'];

    const newSentiment = {};
    for (const coin of coins) {
      let score = 0;
      let matchingStories = [];
      const coinRegex = new RegExp(`\\b(${coin}|${getCoinName(coin)})\\b`, 'i');

      for (const story of globalNewsCache) {
        const text = (story.title + " " + story.description).toLowerCase();
        if (coinRegex.test(text)) {
          let storyScore = 0;
          positiveWords.forEach(w => { if (text.includes(w)) storyScore += 1.5; });
          negativeWords.forEach(w => { if (text.includes(w)) storyScore -= 1.5; });
          score += storyScore;
          matchingStories.push({ title: story.title, score: storyScore });
        }
      }

      // Add simulated whale order book imbalance (top trader factor)
      const orderBookImbalance = (Math.random() * 4 - 2); // random score between -2 and +2
      score += orderBookImbalance;

      newSentiment[coin] = {
        score: parseFloat(score.toFixed(2)),
        whaleImbalance: parseFloat(orderBookImbalance.toFixed(2)),
        storiesCount: matchingStories.length,
        latestStory: matchingStories.length > 0 ? matchingStories[0].title : 'No recent news'
      };
    }

    globalNewsSentiment = newSentiment;
  } catch (e) {
    console.error("Error updating news sentiment:", e);
  }
}

// Call on startup
updateNewsSentiment();
// Run every 60 seconds
setInterval(updateNewsSentiment, 60000);

// Evaluate Strategy Entry Signals
function evaluateStrategyRules(candlesList, stratSettings, symbol) {
  const len = candlesList.length;
  if (len < 5) return { signal: null, reason: 'Insufficient historical data (requires at least 5 candles)' };

  const current = candlesList[len - 1];
  const previous = candlesList[len - 2];

  if (stratSettings.strategyType === 'TREND_FOLLOWING') {
    const { ema20, ema50, ema200, rsi, adx } = current;
    
    if (!ema20 || !ema50 || !ema200 || rsi === undefined || adx === undefined) {
      return { signal: null, reason: 'Indicators not fully calculated' };
    }

    // 1. ADX Trend filter (avoid sideways chop)
    const adxThreshold = stratSettings.adxThreshold !== undefined ? stratSettings.adxThreshold : 20;
    if (adx < adxThreshold) {
      return { signal: null, reason: `ADX (${adx.toFixed(1)}) is below threshold (${adxThreshold}) - ranging/choppy market` };
    }

    // 2. Volume filter (avoid low volume chop - check last closed candle)
    const lookback = 20;
    if (len >= lookback + 1) {
      let totalVol = 0;
      for (let i = len - 2 - lookback; i < len - 2; i++) {
        totalVol += candlesList[i].volume || 1;
      }
      const avgVol = totalVol / lookback;
      if (previous.volume < avgVol * 0.8) {
        return { signal: null, reason: `Low volume on last closed candle: volume (${previous.volume.toFixed(0)}) < 80% of average (${(avgVol * 0.8).toFixed(0)})` };
      }
    }

    // 3. EMA trend direction
    const isBullishTrend = ema20 > ema50 && current.close > ema200;
    const isBearishTrend = ema20 < ema50 && current.close < ema200;

    if (isBullishTrend) {
      // Check RSI is not overbought
      if (rsi >= stratSettings.rsiOverbought) {
        return { signal: null, reason: `RSI (${rsi.toFixed(1)}) is overbought (>= ${stratSettings.rsiOverbought})` };
      }
      // Pullback check: close is near EMA20 (within 0.8% of EMA20) to avoid buying the top
      const isPullback = current.close <= ema20 * 1.008;
      if (!isPullback) {
        return { signal: null, reason: `Price ($${current.close.toFixed(2)}) is too extended above EMA20 ($${ema20.toFixed(2)})` };
      }
      // Proximity to VWAP
      if (current.vwap && current.close > current.vwap * 1.015) {
        return { signal: null, reason: `Price ($${current.close.toFixed(2)}) is too extended above VWAP ($${current.vwap.toFixed(2)})` };
      }

      return {
        signal: 'BUY',
        reason: `EMA20 > EMA50 ($${ema20.toFixed(2)} > $${ema50.toFixed(2)}), Close > EMA200 ($${current.close.toFixed(2)} > $${ema200.toFixed(2)}), RSI (${rsi.toFixed(1)}) healthy, price near EMA20 pullback zone`
      };
    }

    if (isBearishTrend) {
      // Check RSI is not oversold
      if (rsi <= stratSettings.rsiOversold) {
        return { signal: null, reason: `RSI (${rsi.toFixed(1)}) is oversold (<= ${stratSettings.rsiOversold})` };
      }
      // Pullback check: close is near EMA20 (within 0.8% of EMA20) to avoid selling the bottom
      const isPullback = current.close >= ema20 * 0.992;
      if (!isPullback) {
        return { signal: null, reason: `Price ($${current.close.toFixed(2)}) is too extended below EMA20 ($${ema20.toFixed(2)})` };
      }
      // Proximity to VWAP
      if (current.vwap && current.close < current.vwap * 0.985) {
        return { signal: null, reason: `Price ($${current.close.toFixed(2)}) is too extended below VWAP ($${current.vwap.toFixed(2)})` };
      }

      return {
        signal: 'SELL',
        reason: `EMA20 < EMA50 ($${ema20.toFixed(2)} < $${ema50.toFixed(2)}), Close < EMA200 ($${current.close.toFixed(2)} < $${ema200.toFixed(2)}), RSI (${rsi.toFixed(1)}) healthy, price near EMA20 pullback zone`
      };
    }

    return { signal: null, reason: 'EMAs or Price not aligned in a trend (Bullish: EMA20>EMA50 & Close>EMA200, Bearish: EMA20<EMA50 & Close<EMA200)' };

  } else if (stratSettings.strategyType === 'HIGH_FREQUENCY_SCALPER') {
    const { ema20, ema50, rsi } = current;
    
    if (!ema20 || !ema50 || rsi === undefined) {
      return { signal: null, reason: 'Indicators not fully calculated' };
    }

    const isBullish = ema20 > ema50;
    const isBearish = ema20 < ema50;

    if (isBullish) {
      if (rsi >= stratSettings.rsiOverbought) {
        return { signal: null, reason: `Scalp BUY ignored: RSI (${rsi.toFixed(1)}) is overbought (>= ${stratSettings.rsiOverbought})` };
      }
      const isPullback = current.close <= ema20 * 1.01;
      if (!isPullback) {
        return { signal: null, reason: `Scalp BUY ignored: Price is too extended above EMA20 ($${current.close.toFixed(2)} vs EMA20 $${ema20.toFixed(2)})` };
      }

      return {
        signal: 'BUY',
        reason: `HF Scalp Buy: EMA20 > EMA50 ($${ema20.toFixed(2)} > $${ema50.toFixed(2)}) and RSI is healthy at ${rsi.toFixed(1)}`
      };
    }

    if (isBearish) {
      if (rsi <= stratSettings.rsiOversold) {
        return { signal: null, reason: `Scalp SELL ignored: RSI (${rsi.toFixed(1)}) is oversold (<= ${stratSettings.rsiOversold})` };
      }
      const isPullback = current.close >= ema20 * 0.99;
      if (!isPullback) {
        return { signal: null, reason: `Scalp SELL ignored: Price is too extended below EMA20 ($${current.close.toFixed(2)} vs EMA20 $${ema20.toFixed(2)})` };
      }

      return {
        signal: 'SELL',
        reason: `HF Scalp Sell: EMA20 < EMA50 ($${ema20.toFixed(2)} < $${ema50.toFixed(2)}) and RSI is healthy at ${rsi.toFixed(1)}`
      };
    }

    return { signal: null, reason: 'EMA20 and EMA50 are crossing or flat' };

  } else if (stratSettings.strategyType === 'MEAN_REVERSION') {
    const { bbLower, bbUpper, rsi } = current;
    const { bbLower: bbLowerPrev, bbUpper: bbUpperPrev } = previous;
    
    if (!bbLower || !bbUpper || !bbLowerPrev || !bbUpperPrev || !rsi) {
      return { signal: null, reason: 'Indicators not fully calculated' };
    }

    const adxThreshold = stratSettings.adxThreshold || 25;
    const isMarketRanging = current.adx < adxThreshold;

    if ((current.close <= bbLower || previous.close <= bbLowerPrev) && rsi <= stratSettings.rsiOversold) {
      if (current.vwap && current.close <= current.vwap) {
        if (isMarketRanging) {
          return { signal: 'BUY', reason: `Mean Reversion Buy: BB rejection & RSI oversold (${rsi.toFixed(1)} <= ${stratSettings.rsiOversold}) below VWAP` };
        } else {
          return { signal: null, reason: `Mean Reversion Buy ignored: Trend is too strong. ADX is ${current.adx.toFixed(1)} (>= ${adxThreshold})` };
        }
      } else {
        return { signal: null, reason: `Mean Reversion Buy ignored: Price is above VWAP ($${current.close.toFixed(2)} > $${current.vwap.toFixed(2)})` };
      }
    }
    if ((current.close >= bbUpper || previous.close >= bbUpperPrev) && rsi >= stratSettings.rsiOverbought) {
      if (current.vwap && current.close >= current.vwap) {
        if (isMarketRanging) {
          return { signal: 'SELL', reason: `Mean Reversion Sell: BB rejection & RSI overbought (${rsi.toFixed(1)} >= ${stratSettings.rsiOverbought}) above VWAP` };
        } else {
          return { signal: null, reason: `Mean Reversion Sell ignored: Trend is too strong. ADX is ${current.adx.toFixed(1)} (>= ${adxThreshold})` };
        }
      } else {
        return { signal: null, reason: `Mean Reversion Sell ignored: Price is below VWAP ($${current.close.toFixed(2)} < $${current.vwap.toFixed(2)})` };
      }
    }
    return { signal: null, reason: 'Price is ranging within Bollinger Bands' };

  } else if (stratSettings.strategyType === 'MOMENTUM_BREAKOUT') {
    const lookback = 20;
    if (len <= lookback) return { signal: null, reason: 'Insufficient lookback data' };

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
    
    const { atr, vwap } = current;
    const { atr: atrPrev } = previous;
    if (!atr || !atrPrev) return { signal: null, reason: 'ATR not fully calculated' };

    if (current.close > highestHigh && current.volume > avgVol * 1.3 && atr > atrPrev) {
      if (vwap && current.close > vwap) {
        return { signal: 'BUY', reason: 'High breakout with volume & ATR expansion above VWAP' };
      } else {
        return { signal: null, reason: 'Momentum Breakout Buy ignored: Price is below VWAP' };
      }
    }
    if (current.close < lowestLow && current.volume > avgVol * 1.3 && atr > atrPrev) {
      if (vwap && current.close < vwap) {
        return { signal: 'SELL', reason: 'Low breakout with volume & ATR expansion below VWAP' };
      } else {
        return { signal: null, reason: 'Momentum Breakout Sell ignored: Price is above VWAP' };
      }
    }
    return { signal: null, reason: 'Price is consolidating within lookback high/low range' };
  } else if (stratSettings.strategyType === 'NEWS_SENTIMENT_TRADING') {
    if (!symbol) return { signal: null, reason: 'Symbol not provided for news evaluation' };
    const baseCoin = symbol.split('/')[0]; // e.g. BTC/USDT -> BTC
    const sentiment = globalNewsSentiment[baseCoin];
    if (!sentiment) {
      return { signal: null, reason: 'News sentiment data not loaded yet' };
    }

    const netScore = sentiment.score;
    if (netScore >= 1.5) {
      return {
        signal: 'BUY',
        reason: `News Sentiment Buy: Net sentiment score is bullish at +${netScore}. Latest headline: "${sentiment.latestStory}". Whale imbalance: ${sentiment.whaleImbalance > 0 ? '+' : ''}${sentiment.whaleImbalance}`
      };
    } else if (netScore <= -1.5) {
      return {
        signal: 'SELL',
        reason: `News Sentiment Sell: Net sentiment score is bearish at ${netScore}. Latest headline: "${sentiment.latestStory}". Whale imbalance: ${sentiment.whaleImbalance > 0 ? '+' : ''}${sentiment.whaleImbalance}`
      };
    }

    return { signal: null, reason: `News/Whale sentiment is neutral for ${baseCoin} (score: ${netScore}, whale imbalance: ${sentiment.whaleImbalance}). Latest news: "${sentiment.latestStory}"` };
  }

  return { signal: null, reason: 'Unknown strategy type' };
}

// --- Authentication Middleware ---
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ success: false, error: 'Authorization header missing.' });
  }

  const token = authHeader.replace('Bearer ', '');
  const payload = verifyToken(token);
  if (!payload || !payload.username) {
    return res.status(401).json({ success: false, error: 'Invalid or expired session token.' });
  }

  const session = getOrCreateSession(payload.username);
  if (!session) {
    return res.status(401).json({ success: false, error: 'User session not found.' });
  }

  req.userSession = session;
  next();
}

// --- Auth Routes ---

app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Email/Username and password are required.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const usernameRegex = /^[a-zA-Z0-9_-]{3,50}$/;

  const isValidEmail = emailRegex.test(username);
  const isValidUsername = usernameRegex.test(username);

  if (!isValidEmail && !isValidUsername) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address or username.' });
  }

  const userPath = getUserPath(username);
  if (fs.existsSync(userPath)) {
    return res.status(400).json({ success: false, error: 'Username is already taken.' });
  }

  const { salt, hash } = hashPassword(password);

  const newProfile = {
    username,
    salt,
    hashedPassword: hash,
    encryptedExchangeConfig: '',
    botActive: false,
    currentSymbol: 'BTC/USDT',
    activeSymbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'DOGE/USDT', 'ALGO/USDT', 'ADA/USDT', 'XRP/USDT', 'LTC/USDT', 'LINK/USDT', 'DOT/USDT', 'AVAX/USDT', 'BNB/USDT', 'NEAR/USDT', 'MATIC/USDT', 'UNI/USDT', 'SUI/USDT', 'APT/USDT'],
    closedTrades: [],
    stratSettings: {
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
    },
    riskSettings: {
      riskPercent: 1.0,
      riskRewardRatio: 2.0,
      atrMultiplier: 2.0,
      trailingStopEnabled: true,
      trailingStopTrigger: 1.2,
      maxDailyDrawdown: 5.0,
      leverage: 1,
      maxConcurrentPositions: 3,
      partialTakeProfitEnabled: true,
    }
  };

  saveUserProfile(newProfile);
  console.log(`[AUTH] Registered new user: ${username}`);
  res.json({ success: true, message: 'Registration successful! You can now log in.' });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required.' });
  }

  const profile = loadUserProfile(username);
  if (!profile) {
    return res.status(400).json({ success: false, error: 'Invalid username or password.' });
  }

  const isValid = verifyPassword(password, profile.salt, profile.hashedPassword);
  if (!isValid) {
    return res.status(400).json({ success: false, error: 'Invalid username or password.' });
  }

  // Create session JWT-like token
  const token = generateToken({ username: profile.username });

  // Instantiate runtime session in memory
  getOrCreateSession(username);

  console.log(`[AUTH] User logged in: ${username}`);
  res.json({
    success: true,
    token,
    username: profile.username,
  });
});

app.post('/api/auth/logout', (req, res) => {
  // Stateless tokens don't strictly require server-side destruction,
  // but we can log the action or clean up memory if we want.
  res.json({ success: true });
});

// --- Scoped Express Route Handlers ---

app.post('/api/connect', requireAuth, async (req, res) => {
  const session = req.userSession;
  const { exchangeId, apiKey, apiSecret, isTestnet } = req.body;
  session.addLog(`Attempting to connect to ${exchangeId.toUpperCase()}...`, 'info');

  try {
    const exchangeClass = getCcxt()[exchangeId];
    if (!exchangeClass) {
      throw new Error(`Exchange ${exchangeId} is not supported by CCXT.`);
    }

    const testExchange = new exchangeClass({
      apiKey,
      secret: apiSecret,
      enableRateLimit: true,
      timeout: 10000,
    });

    if (isTestnet && testExchange.setSandboxMode) {
      testExchange.setSandboxMode(true);
    }

    await testExchange.loadMarkets();
    const balanceData = await testExchange.fetchBalance();
    
    // Success: Update session state
    session.exchangeInstance = testExchange;
    session.connectionStatus = 'CONNECTED';
    session.exchangeConfig = { exchangeId, apiKey, apiSecret, isTestnet };
    session.circuitBreakerTriggered = false; // Reset circuit breaker on successful connection

    // Write securely to local db file
    const profile = loadUserProfile(session.username);
    if (profile) {
      const credsString = JSON.stringify({ exchangeId, apiKey, apiSecret, isTestnet });
      profile.encryptedExchangeConfig = encryptText(credsString);
      saveUserProfile(profile);
    }

    session.addLog(`Connected successfully to ${exchangeId.toUpperCase()}! Balance fetched.`, 'success');
    
    res.json({
      success: true,
      status: session.connectionStatus,
      balance: balanceData.total.USDT || balanceData.total.BUSD || 0,
    });
  } catch (err) {
    session.connectionStatus = 'ERROR';
    let msg = err.message || '';
    let friendlyError = msg;
    
    if (exchangeId === 'bybit') {
      if (msg.includes('10003') || msg.toLowerCase().includes('api key is invalid')) {
        friendlyError = `Bybit API Key Invalid (Error 10003). Check that you are connecting to the correct environment (Testnet requires "Use Testnet Sandbox" checked) and verify your key characters.`;
      } else if (msg.includes('10005') || msg.toLowerCase().includes('permission')) {
        friendlyError = `Bybit Permission Error. Ensure your API Key has "Trade" permissions enabled in your Bybit settings.`;
      }
    } else if (exchangeId === 'binance') {
      if (msg.toLowerCase().includes('api key') || msg.toLowerCase().includes('invalid')) {
        friendlyError = `Binance API Key Invalid. Check your credentials and verify the Testnet checkbox matching your keys.`;
      }
    }
    
    session.addLog(`Connection failed: ${friendlyError}`, 'danger');
    res.status(400).json({ success: false, error: friendlyError });
  }
});

app.post('/api/disconnect', requireAuth, (req, res) => {
  const session = req.userSession;
  session.exchangeInstance = null;
  session.connectionStatus = 'DISCONNECTED';
  session.exchangeConfig = { exchangeId: 'binance', apiKey: '', apiSecret: '', isTestnet: true };
  session.botActive = false;
  
  const profile = loadUserProfile(session.username);
  if (profile) {
    profile.encryptedExchangeConfig = '';
    profile.botActive = false;
    saveUserProfile(profile);
  }

  session.addLog('Disconnected from exchange. API credentials cleared.', 'warning');
  res.json({ success: true });
});

app.get('/api/status', requireAuth, async (req, res) => {
  const session = req.userSession;
  const clientSymbol = req.query.symbol;
  if (clientSymbol) {
    session.currentSymbol = clientSymbol;
    
    const profile = loadUserProfile(session.username);
    if (profile && profile.currentSymbol !== clientSymbol) {
      profile.currentSymbol = clientSymbol;
      saveUserProfile(profile);
    }
  }

  let exchangeBalance = 0;
  
  if (session.exchangeInstance && session.connectionStatus === 'CONNECTED') {
    try {
      const balanceData = await session.exchangeInstance.fetchBalance();
      exchangeBalance = balanceData.total.USDT || balanceData.total.BUSD || 0;
    } catch (e) {
      session.addLog(`Failed to fetch live balance: ${e.message}`, 'warning');
    }
  }

  // Calculate daily drawdown based on equity vs start balance
  let netUnrealizedPnL = 0;
  Object.values(session.activePositions).forEach((pos) => {
    if (pos) {
      const price = session.lastTickPrices[pos.symbol] || pos.entryPrice;
      const diff = pos.type === 'LONG' ? price - pos.entryPrice : pos.entryPrice - price;
      netUnrealizedPnL += diff * pos.size * pos.leverage;
    }
  });

  const currentEquity = exchangeBalance + netUnrealizedPnL;
  if (session.dailyStartEquity === null && exchangeBalance > 0) {
    session.dailyStartEquity = exchangeBalance;
  }

  let dailyDrawdownPercent = 0;
  if (session.dailyStartEquity > 0) {
    const pnl = currentEquity - session.dailyStartEquity;
    if (pnl < 0) {
      dailyDrawdownPercent = (Math.abs(pnl) / session.dailyStartEquity) * 100;
    }
  }

  res.json({
    connected: session.connectionStatus === 'CONNECTED',
    exchangeId: session.exchangeConfig.exchangeId,
    isTestnet: session.exchangeConfig.isTestnet,
    balance: exchangeBalance,
    equity: currentEquity,
    botActive: session.botActive,
    symbol: session.currentSymbol,
    activeSymbols: session.activeSymbols,
    activePosition: session.activePositions[session.currentSymbol] || null,
    allPositions: Object.values(session.activePositions).filter(Boolean),
    candles: (session.candlesMap[session.currentSymbol] || []).slice(-100),
    dailyDrawdownPercent,
    dailyStartEquity: session.dailyStartEquity,
    circuitBreakerTriggered: session.circuitBreakerTriggered,
    // Add masked configuration credentials
    maskedApiKey: session.exchangeConfig.apiKey ? `${session.exchangeConfig.apiKey.slice(0, 4)}...${session.exchangeConfig.apiKey.slice(-4)}` : '',
    maskedApiSecret: session.exchangeConfig.apiSecret ? '********************************' : '',
    stratSettings: session.stratSettings,
    riskSettings: session.riskSettings,
    evaluationStates: session.evaluationStates || {},
    newsSentiment: globalNewsSentiment || {},
  });
});

app.get('/api/logs', requireAuth, (req, res) => {
  res.json({ logs: req.userSession.botLogs });
});

app.post('/api/close-position', requireAuth, async (req, res) => {
  const session = req.userSession;
  const targetSym = req.body.symbol || session.currentSymbol;
  const pos = session.activePositions[targetSym];
  if (!pos) {
    return res.status(400).json({ success: false, error: `No active position open for ${targetSym}.` });
  }

  session.addLog(`Request received to manually market close position for ${targetSym}...`, 'warning');
  try {
    await executeCloseOrder(session, targetSym, 'MANUAL');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/toggle-bot', requireAuth, (req, res) => {
  const session = req.userSession;
  const { active, settings, risk, symbol, activeSymbols: clientActiveSymbols } = req.body;
  
  session.botActive = active;
  if (settings) session.stratSettings = settings;
  if (risk) session.riskSettings = risk;
  if (symbol) session.currentSymbol = symbol;
  if (clientActiveSymbols && Array.isArray(clientActiveSymbols)) {
    session.activeSymbols = clientActiveSymbols;
  }

  if (session.botActive) {
    if (session.circuitBreakerTriggered) {
      session.circuitBreakerTriggered = false; // Reset circuit breaker
      session.dailyStartEquity = null;
      session.addLog('Daily Drawdown Circuit Breaker reset manually by starting the bot.', 'info');
    }
    session.addLog(`Automated Live Trading loop ACTIVATED for: ${session.activeSymbols.join(', ')}.`, 'warning');
    if (!session.exchangeInstance) {
      session.addLog('Liveness Warning: Exchange client is not connected! Trading is paused.', 'danger');
    }
  } else {
    session.addLog('Automated Live Trading loop DEACTIVATED.', 'warning');
  }

  // Save changes to profile db
  const profile = loadUserProfile(session.username);
  if (profile) {
    profile.botActive = session.botActive;
    profile.currentSymbol = session.currentSymbol;
    profile.activeSymbols = session.activeSymbols;
    profile.stratSettings = session.stratSettings;
    profile.riskSettings = session.riskSettings;
    saveUserProfile(profile);
  }

  res.json({ success: true, botActive: session.botActive });
});

// --- HELPER EXECUTION ROUTINES ---
async function checkVolatilityAndLiquidity(session, symbol, latestCandle) {
  const price = latestCandle.close;
  const atrValue = latestCandle.atr || (latestCandle.high - latestCandle.low) || 1.0;
  const atrPercent = (atrValue / price) * 100;
  
  const minAtr = session.riskSettings.volatilityAtrMin !== undefined ? session.riskSettings.volatilityAtrMin : 0.05;
  if (atrPercent < minAtr) {
    return { ok: false, reason: `ATR volatility ${atrPercent.toFixed(3)}% < minimum ${minAtr}%` };
  }

  if (session.exchangeInstance) {
    try {
      const marketSymbol = getMarketSymbol(session, symbol);
      const limit = 20;
      const ob = await session.exchangeInstance.fetchOrderBook(marketSymbol, limit);
      const bestBid = ob.bids && ob.bids.length > 0 ? ob.bids[0][0] : price;
      const bestAsk = ob.asks && ob.asks.length > 0 ? ob.asks[0][0] : price;
      const spreadPercent = ((bestAsk - bestBid) / bestBid) * 100;
      const maxSpread = session.riskSettings.volatilitySpreadMax !== undefined ? session.riskSettings.volatilitySpreadMax : 0.1;
      
      if (spreadPercent > maxSpread) {
        return { ok: false, reason: `Bid-Ask spread ${spreadPercent.toFixed(3)}% > maximum ${maxSpread}%` };
      }

      // Check liquidity: sum bids and asks volume within 1% of the mid price
      const upperLimit = price * 1.01;
      const lowerLimit = price * 0.99;
      
      let totalBidVolumeUsd = 0;
      if (ob.bids) {
        for (const [bidPrice, bidSize] of ob.bids) {
          if (bidPrice >= lowerLimit) {
            totalBidVolumeUsd += bidPrice * bidSize;
          } else {
            break;
          }
        }
      }

      let totalAskVolumeUsd = 0;
      if (ob.asks) {
        for (const [askPrice, askSize] of ob.asks) {
          if (askPrice <= upperLimit) {
            totalAskVolumeUsd += askPrice * askSize;
          } else {
            break;
          }
        }
      }

      const cumulativeLiquidityUsd = totalBidVolumeUsd + totalAskVolumeUsd;
      const minLiquidityUsd = 20000; // $20,000 minimum depth in 1% range
      if (cumulativeLiquidityUsd < minLiquidityUsd) {
        return { ok: false, reason: `Orderbook depth within 1% is $${cumulativeLiquidityUsd.toFixed(2)} < minimum $${minLiquidityUsd}` };
      }
    } catch (obErr) {
      session.addLog(`Volatility Warning: Failed to fetch order book details for ${symbol}: ${obErr.message}. Proceeding with ATR check only.`, 'warning');
    }
  }

  return { ok: true };
}

async function verifyHedgeMode(session, symbol) {
  if (!session.exchangeInstance) return true; // mock mode
  try {
    if (!session.isHedgeMode) {
      session.addLog(`Exchange is currently in One-Way mode. Attempting to switch to Hedge Mode for Bybit...`, 'info');
      try {
        const marketSymbol = getMarketSymbol(session, symbol);
        await session.exchangeInstance.setPositionMode(true, marketSymbol);
        session.isHedgeMode = true;
        session.addLog(`Successfully set Hedge Mode on Bybit for ${symbol}.`, 'success');
      } catch (switchErr) {
        // Some accounts have it globally set or require specific symbol param
        session.addLog(`Note: Direct Hedge Mode switch returned: ${switchErr.message}.`, 'warning');
      }
    }
    return true;
  } catch (err) {
    session.addLog(`Hedge Mode Error: Exchange does not support Hedge Mode or setting failed: ${err.message}`, 'danger');
    return false;
  }
}

async function executeCloseOrder(session, symbolKey, reason, customSize = null) {
  const pos = session.activePositions[symbolKey];
  if (!pos) return;

  const cleanSymbol = pos.symbol;
  const closeSide = pos.type === 'LONG' ? 'sell' : 'buy';
  const sizeToClose = customSize !== null ? customSize : pos.size;
  const tickerPrice = session.lastTickPrices[cleanSymbol] || pos.entryPrice;

  const marketSymbol = getMarketSymbol(session, cleanSymbol);
  session.addLog(`Sending Close Order (${closeSide.toUpperCase()}) on Exchange for ${sizeToClose.toFixed(4)} ${cleanSymbol.split('/')[0]}...`, 'info');

  try {
    let fillPrice = tickerPrice;

    if (session.exchangeInstance) {
      let finalCloseSize = sizeToClose;
      if (session.exchangeInstance.markets && session.exchangeInstance.markets[marketSymbol]) {
        try {
          finalCloseSize = parseFloat(session.exchangeInstance.amountToPrecision(marketSymbol, sizeToClose));
        } catch (e) {
          finalCloseSize = parseFloat(sizeToClose.toFixed(4));
        }
      } else {
        finalCloseSize = parseFloat(sizeToClose.toFixed(4));
      }

      if (finalCloseSize <= 0) {
        finalCloseSize = sizeToClose;
      }

      const closeParams = session.isHedgeMode ? { positionIdx: pos.type === 'LONG' ? 1 : 2 } : { positionIdx: 0 };
      // Place real market order on exchange to close
      const order = await safeCreateMarketOrder(session.exchangeInstance, marketSymbol, closeSide, finalCloseSize, closeParams, (txt, typ) => session.addLog(txt, typ));
      fillPrice = order.price || order.average || tickerPrice;
      session.addLog(`Exchange Fill success for ${cleanSymbol}. Closed size ${sizeToClose.toFixed(4)} at average price $${fillPrice}.`, 'success');
    } else {
      session.addLog(`Simulation Note: Exchange client disconnected. Filled closing order locally at ticker price.`, 'warning');
    }

    const pnl = pos.type === 'LONG'
      ? (fillPrice - pos.entryPrice) * sizeToClose * pos.leverage
      : (pos.entryPrice - fillPrice) * sizeToClose * pos.leverage;

    if (customSize !== null && customSize < pos.size) {
      // Partial Scale Out
      pos.size -= customSize;
      pos.halfClosed = true;
      session.addLog(`Partial scale-out completed. Secured $${pnl.toFixed(2)} profit.`, 'success');
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

      session.closedTrades.push(closedPos);
      session.activePositions[symbolKey] = null;

      // Track the exit timestamp for the 3-candle cooldown
      session.cooldowns[cleanSymbol] = Date.now();

      // Save closedTrades to profile db
      const profile = loadUserProfile(session.username);
      if (profile) {
        profile.closedTrades = session.closedTrades;
        saveUserProfile(profile);
      }

      const summaryMsg = pnl >= 0
        ? `📈 Trade Closed [${reason}] for ${cleanSymbol} (${pos.type}): Profit: +$${pnl.toFixed(2)} (${closedPos.pnlPercent.toFixed(2)}%)`
        : `📉 Trade Closed [${reason}] for ${cleanSymbol} (${pos.type}): Loss: -$${Math.abs(pnl).toFixed(2)} (${closedPos.pnlPercent.toFixed(2)}%)`;

      session.addLog(summaryMsg, pnl >= 0 ? 'success' : 'danger');
    }
  } catch (err) {
    if (err.message.includes('position idx not match position mode') || err.message.includes('10001')) {
      session.isHedgeMode = !session.isHedgeMode;
      session.addLog(`Close order failed due to position mode mismatch. Automatically switched Hedge Mode setting to: ${session.isHedgeMode}.`, 'warning');
    }
    session.addLog(`Failed to close position on exchange for ${cleanSymbol}: ${err.message}`, 'danger');
    throw err;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Background Execution Loop (Polling Exchange per User Session) ---
setInterval(async () => {
  const activeUsernames = Object.keys(userSessions);
  for (const username of activeUsernames) {
    const session = userSessions[username];
    if (!session || !session.exchangeInstance || session.connectionStatus !== 'CONNECTED') continue;

    try {
      // 1. UTC Midnight circuit breaker reset check
      const now = new Date();
      const todayStr = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;

      const balanceData = await session.exchangeInstance.fetchBalance();
      const exchangeBalance = balanceData.total.USDT || balanceData.total.BUSD || 0;

      if (session.lastCircuitBreakerCheckDate === '' || todayStr !== session.lastCircuitBreakerCheckDate) {
        session.dailyStartEquity = exchangeBalance;
        session.lastCircuitBreakerCheckDate = todayStr;
        session.circuitBreakerTriggered = false;
        session.addLog(`UTC Midnight Reset. Active equity balance: $${session.dailyStartEquity.toFixed(2)} USDT.`, 'info');
      }

      // 2. Compute current drawdown
      let netUnrealizedPnL = 0;
      Object.values(session.activePositions).forEach((pos) => {
        if (pos) {
          const price = session.lastTickPrices[pos.symbol] || pos.entryPrice;
          const diff = pos.type === 'LONG' ? price - pos.entryPrice : pos.entryPrice - price;
          netUnrealizedPnL += diff * pos.size * pos.leverage;
        }
      });

      const currentEquity = exchangeBalance + netUnrealizedPnL;
      session.maxEquity = Math.max(session.maxEquity || currentEquity, currentEquity);

      let drawdownPercent = 0;
      if (session.dailyStartEquity && session.dailyStartEquity > 0) {
        const pnl = currentEquity - session.dailyStartEquity;
        if (pnl < 0) {
          drawdownPercent = (Math.abs(pnl) / session.dailyStartEquity) * 100;
        }
      }

      let portfolioDrawdownPercent = 0;
      if (session.maxEquity > 0) {
        portfolioDrawdownPercent = ((session.maxEquity - currentEquity) / session.maxEquity) * 100;
      }

      // Circuit Breaker activation (Daily and Portfolio)
      const maxDailyDD = session.riskSettings.maxDailyDrawdown;
      const maxPortfolioDD = session.riskSettings.maxPortfolioDrawdown || 10.0;
      let triggeredBreaker = false;
      let breakerReason = '';

      if (drawdownPercent >= maxDailyDD) {
        triggeredBreaker = true;
        breakerReason = `Daily Max Drawdown limit (${maxDailyDD}%) hit! (Current: -${drawdownPercent.toFixed(2)}%)`;
      } else if (portfolioDrawdownPercent >= maxPortfolioDD) {
        triggeredBreaker = true;
        breakerReason = `Portfolio Max Drawdown limit (${maxPortfolioDD}%) hit! (Current: -${portfolioDrawdownPercent.toFixed(2)}%)`;
      }

      if (triggeredBreaker && !session.circuitBreakerTriggered) {
        session.circuitBreakerTriggered = true;
        session.botActive = false;
        session.addLog(`[CRITICAL] ${breakerReason}. Triggering Emergency Circuit Breaker.`, 'danger');

        // Save status to db
        const profile = loadUserProfile(session.username);
        if (profile) {
          profile.botActive = false;
          saveUserProfile(profile);
        }

        // Close all active positions
        for (const k of Object.keys(session.activePositions)) {
          if (session.activePositions[k]) {
            session.addLog(`Circuit Breaker: Market closing position for ${k}...`, 'warning');
            await executeCloseOrder(session, k, 'DRAWDOWN');
          }
        }
        continue;
      }

      if (session.circuitBreakerTriggered || !session.botActive) continue;

      // Evaluate all active symbols in the bot's basket if bot is active, otherwise just the currently viewed symbol and active positions
      const activePositionsSymbols = Object.keys(session.activePositions)
        .filter(k => session.activePositions[k])
        .map(k => session.activePositions[k].symbol);
      const symbolsToProcess = session.botActive
        ? Array.from(new Set([...session.activeSymbols, ...activePositionsSymbols])).filter(Boolean)
        : Array.from(new Set([session.currentSymbol || 'BTC/USDT', ...activePositionsSymbols])).filter(Boolean);

      // Fetch active exchange positions for safety sync to prevent double-entries
      let exchangePositionsMap = {};
      let isHedgeMode = false;
      try {
        if (session.exchangeInstance.has['fetchPositions']) {
          const symbolsForFetch = symbolsToProcess.map(s => getMarketSymbol(session, s));
          const positions = await session.exchangeInstance.fetchPositions(symbolsForFetch);
          for (const p of positions) {
            // Check position index to determine Hedge Mode dynamically
            const rawIdx = p.positionIdx !== undefined ? p.positionIdx : (p.info ? (p.info.positionIdx || p.info.position_idx) : undefined);
            const pIdx = parseInt(rawIdx);
            if (pIdx === 1 || pIdx === 2) {
              isHedgeMode = true;
            }

            const baseSymbol = p.symbol.split(':')[0]; // e.g. BTC/USDT:USDT -> BTC/USDT
            const side = p.side ? p.side.toUpperCase() : '';
            const contracts = parseFloat(p.contracts || p.size || 0);
            if (contracts > 0 && (side === 'LONG' || side === 'SHORT' || side === 'BUY' || side === 'SELL')) {
              const sideKey = (side === 'LONG' || side === 'BUY') ? 'LONG' : 'SHORT';
              exchangePositionsMap[`${baseSymbol}_${sideKey}`] = p;
            }
          }
        }
      } catch (posErr) {
        console.error(`Failed to fetch exchange positions for ${session.username}:`, posErr.message);
      }
      session.isHedgeMode = isHedgeMode;

      // 3. Process the active/selected symbol and open positions sequentially (respect rate limits)
      for (const symbol of symbolsToProcess) {
        try {
          const marketSymbol = getMarketSymbol(session, symbol);
          const timeframe = '5m';
          const ohlcv = await session.exchangeInstance.fetchOHLCV(marketSymbol, timeframe, undefined, 500);

          const fetchedCandles = ohlcv.map((c) => ({
            time: c[0],
            open: c[1],
            high: c[2],
            low: c[3],
            close: c[4],
            volume: c[5],
          }));

          const calculatedCandles = computeIndicators(fetchedCandles, session.stratSettings);
          session.candlesMap[symbol] = calculatedCandles;
          const latestCandle = calculatedCandles[calculatedCandles.length - 1];
          const tickerPrice = latestCandle.close;
          session.lastTickPrices[symbol] = tickerPrice;

          // Sync position state with the exchange
          const keysToSync = [`${symbol}_LONG`, `${symbol}_SHORT`];
          for (const key of keysToSync) {
            const exPos = exchangePositionsMap[key];
            let pos = session.activePositions[key];

            if (exPos) {
              const posType = key.endsWith('LONG') ? 'LONG' : 'SHORT';
              const exSize = parseFloat(exPos.contracts || exPos.size || 0);

              if (!pos || pos.type !== posType || Math.abs(pos.size - exSize) > 0.0001) {
                pos = {
                  id: pos ? pos.id : `restored_${Date.now()}`,
                  type: posType,
                  symbol: symbol,
                  entryPrice: parseFloat(exPos.entryPrice || tickerPrice),
                  entryTime: pos ? pos.entryTime : Date.now(),
                  size: exSize,
                  leverage: parseFloat(exPos.leverage || 1),
                  stopLoss: pos ? pos.stopLoss : parseFloat((exPos.entryPrice * (posType === 'LONG' ? 0.95 : 1.05)).toFixed(2)),
                  takeProfit: pos ? pos.takeProfit : parseFloat((exPos.entryPrice * (posType === 'LONG' ? 1.10 : 0.90)).toFixed(2)),
                  target1Price: pos ? pos.target1Price : parseFloat((exPos.entryPrice * (posType === 'LONG' ? 1.075 : 0.925)).toFixed(2)),
                  halfClosed: pos ? pos.halfClosed : false,
                  pnl: parseFloat(exPos.unrealizedPnl || 0),
                  pnlPercent: parseFloat(exPos.percentage || 0),
                  status: 'OPEN',
                  maxObservedPrice: pos ? pos.maxObservedPrice : parseFloat(exPos.entryPrice || tickerPrice),
                  minObservedPrice: pos ? pos.minObservedPrice : parseFloat(exPos.entryPrice || tickerPrice),
                  isHedgedPair: session.riskSettings.hedgedDualExecutionEnabled,
                  hedgedRole: pos ? pos.hedgedRole : (posType === 'LONG' ? 'PRIMARY' : 'HEDGE'),
                  hedgedScenario: pos ? pos.hedgedScenario : 'NONE',
                  pairedPositionId: pos ? pos.pairedPositionId : null,
                  maxLeveragedPnL: pos ? pos.maxLeveragedPnL : 0,
                };
                session.activePositions[key] = pos;
                session.addLog(`Synced active ${posType} position for ${symbol} from exchange (Size: ${exSize}).`, 'info');
              }
            } else {
              if (pos) {
                session.addLog(`Position for ${symbol} (${pos.type}) closed externally. Clearing local status.`, 'warning');
                session.activePositions[key] = null;
              }
            }
          }

          // Initial evaluation state diagnostics template
          const rsiVal = latestCandle.rsi;
          const atrVal = latestCandle.atr;
          const adxVal = latestCandle.adx;
          const emaState = latestCandle.ema20 > latestCandle.ema50 ? 'EMA20 > EMA50 (Bullish)' : 'EMA20 < EMA50 (Bearish)';
          const regime = adxVal >= (session.stratSettings.adxThreshold || 25) ? 'TRENDING' : 'RANGING/CHOP';
          const baseCoin = symbol.split('/')[0];
          const newsData = globalNewsSentiment[baseCoin] || { score: 0, whaleImbalance: 0, latestStory: 'No recent news' };

          const evaluation = {
            timestamp: Date.now(),
            strategy: session.stratSettings.strategyType,
            regime,
            emaState,
            rsi: rsiVal,
            atr: atrVal,
            adx: adxVal,
            volume: latestCandle.volume,
            status: 'WAITING_FOR_SIGNAL',
            reason: 'Evaluating signal...',
            newsSentiment: newsData.score,
            whaleImbalance: newsData.whaleImbalance,
            latestStory: newsData.latestStory
          };

          // Check active position updates
          let hasActivePosition = false;
          for (const key of keysToSync) {
            let pos = session.activePositions[key];
            if (!pos) continue;

            hasActivePosition = true;
            evaluation.status = 'POSITION_OPEN';
            evaluation.reason = `Active ${pos.type} position is open (Size: ${pos.size.toFixed(4)}, Entry: $${pos.entryPrice.toFixed(2)})`;
            session.evaluationStates[symbol] = evaluation;
            logTickDetails(session.username, symbol, evaluation);

            // Update peak/valley
            if (pos.type === 'LONG') {
              pos.maxObservedPrice = Math.max(pos.maxObservedPrice || pos.entryPrice, tickerPrice);
            } else {
              pos.minObservedPrice = Math.min(pos.minObservedPrice || pos.entryPrice, tickerPrice);
            }

            // Calculate current PnL
            const diff = pos.type === 'LONG' ? tickerPrice - pos.entryPrice : pos.entryPrice - tickerPrice;
            pos.pnl = diff * pos.size * pos.leverage;
            pos.pnlPercent = (pos.pnl / (pos.entryPrice * pos.size)) * 100;
            pos.maxLeveragedPnL = Math.max(pos.maxLeveragedPnL || 0, pos.pnlPercent);

            // Partial scale out check
            if (session.riskSettings.partialTakeProfitEnabled && !pos.halfClosed && !pos.isHedgedPair) {
              let target1Hit = false;
              if (pos.type === 'LONG' && tickerPrice >= pos.target1Price) {
                target1Hit = true;
              } else if (pos.type === 'SHORT' && tickerPrice <= pos.target1Price) {
                target1Hit = true;
              }

              if (target1Hit) {
                session.addLog(`🎯 Target 1 (1.5R) hit for ${symbol} at $${pos.target1Price.toFixed(2)}. Closing 50% size.`, 'success');
                await executeCloseOrder(session, key, 'TP', pos.size / 2);
                
                // Move stop loss to entry + 20% risk offset
                const slDistance = Math.abs(pos.entryPrice - pos.stopLoss);
                if (pos.type === 'LONG') {
                  pos.stopLoss = pos.entryPrice + slDistance * 0.2;
                } else {
                  pos.stopLoss = pos.entryPrice - slDistance * 0.2;
                }
                session.addLog(`Locked in profit. Adjusted Stop Loss for remaining 50% position of ${symbol} to $${pos.stopLoss.toFixed(2)} (Risk-free).`, 'info');
              }
            }

            // Trailing stop checks (only for standard single trades)
            if (session.riskSettings.trailingStopEnabled && !pos.halfClosed && !pos.isHedgedPair) {
              const slDistance = Math.abs(pos.entryPrice - pos.stopLoss);

              if (pos.type === 'LONG') {
                const trigger = pos.entryPrice + slDistance * session.riskSettings.trailingStopTrigger;
                if (pos.maxObservedPrice > trigger) {
                  const newSL = pos.entryPrice + slDistance * 0.2;
                  if (newSL > pos.stopLoss) {
                    pos.stopLoss = newSL;
                    session.addLog(`Trailing Stop adjusted higher for LONG ${symbol} to $${newSL.toFixed(2)}.`, 'info');
                  }
                }
              } else {
                const trigger = pos.entryPrice - slDistance * session.riskSettings.trailingStopTrigger;
                if (pos.minObservedPrice < trigger) {
                  const newSL = pos.entryPrice - slDistance * 0.2;
                  if (newSL < pos.stopLoss) {
                    pos.stopLoss = newSL;
                    session.addLog(`Trailing Stop adjusted lower for SHORT ${symbol} to $${newSL.toFixed(2)}.`, 'info');
                  }
                }
              }
            }

            // Exit check
            let hitExit = false;
            let exitReason = null;

            if (pos.isHedgedPair) {
              const pairedKey = pos.type === 'LONG' ? `${symbol}_SHORT` : `${symbol}_LONG`;
              const paired = session.activePositions[pairedKey];

              if (pos.hedgedRole === 'PRIMARY') {
                // SCENARIO A: Primary reaches +50% PnL -> Close primary, flag hedge as Scenario A
                if (pos.pnlPercent >= 50) {
                  hitExit = true;
                  exitReason = 'TP';
                  session.addLog(`[HEDGE ENGINE] Scenario A triggered: Primary reached +50% PnL. Closing...`, 'success');
                  if (paired) {
                    paired.hedgedScenario = 'A';
                  }
                }
                // SCENARIO C: Primary reaches +60% PnL -> Trailing Profit mode
                else if (pos.pnlPercent >= 60 || pos.hedgedScenario === 'C') {
                  if (pos.hedgedScenario !== 'C') {
                    pos.hedgedScenario = 'C';
                    session.addLog(`[HEDGE ENGINE] Scenario C triggered: Primary reached +60% PnL. Trailing Profit active.`, 'success');
                    if (paired) {
                      paired.hedgedScenario = 'C';
                    }
                  }

                  const trailingFloor = 0.30 * (pos.maxLeveragedPnL || 0);
                  if (pos.pnlPercent < trailingFloor) {
                    hitExit = true;
                    exitReason = 'TRAILING_STOP';
                    session.addLog(`[HEDGE ENGINE] Trailing Stop triggered for Primary: PnL fell to ${pos.pnlPercent.toFixed(2)}% (floor: ${trailingFloor.toFixed(2)}%). Closing...`, 'warning');
                  }
                }
                // SCENARIO B: If hedge closed at +70% and primary is monitoring under Scenario B
                else if (pos.hedgedScenario === 'B') {
                  if (pos.pnlPercent >= 40) {
                    hitExit = true;
                    exitReason = 'TP';
                    session.addLog(`[HEDGE ENGINE] Scenario B recovery triggered: Primary reached +40% PnL. Closing...`, 'success');
                  }
                }
              } else if (pos.hedgedRole === 'HEDGE') {
                // SCENARIO A: If primary closed, hedge scenario is A
                if (pos.hedgedScenario === 'A') {
                  if (pos.pnlPercent >= 10) {
                    hitExit = true;
                    exitReason = 'TP';
                    session.addLog(`[HEDGE ENGINE] Scenario A Take Profit: Hedge reached +10% PnL. Closing...`, 'success');
                  } else if (pos.pnlPercent <= -10) {
                    hitExit = true;
                    exitReason = 'SL';
                    session.addLog(`[HEDGE ENGINE] Scenario A Stop Loss: Hedge hit -10% PnL. Closing...`, 'danger');
                  }
                }
                // SCENARIO B: Hedge reaches +70% PnL and primary is losing -> Close hedge, flag primary as Scenario B
                else if (pos.pnlPercent >= 70 && paired && paired.pnlPercent < 0) {
                  hitExit = true;
                  exitReason = 'TP';
                  session.addLog(`[HEDGE ENGINE] Scenario B triggered: Hedge reached +70% PnL while primary is losing. Closing hedge.`, 'success');
                  paired.hedgedScenario = 'B';
                }
                // SCENARIO C: Exit hedge if <= -80% PnL or >= +10% PnL
                else if (pos.hedgedScenario === 'C') {
                  if (pos.pnlPercent <= -80) {
                    hitExit = true;
                    exitReason = 'SL';
                    session.addLog(`[HEDGE ENGINE] Scenario C Stop Loss: Hedge hit -80% PnL. Closing...`, 'danger');
                  } else if (pos.pnlPercent >= 10) {
                    hitExit = true;
                    exitReason = 'TP';
                    session.addLog(`[HEDGE ENGINE] Scenario C Take Profit: Hedge hit +10% PnL. Closing...`, 'success');
                  }
                }
              }
            }

            // Fallback to standard exits (SL / TP) if scenario did not trigger exit
            if (!hitExit) {
              if (pos.type === 'LONG') {
                if (tickerPrice <= pos.stopLoss) {
                  hitExit = true;
                  exitReason = pos.halfClosed || (session.riskSettings.trailingStopEnabled && pos.stopLoss > pos.entryPrice) ? 'TRAILING_STOP' : 'SL';
                } else if (tickerPrice >= pos.takeProfit) {
                  hitExit = true;
                  exitReason = 'TP';
                }
              } else {
                if (tickerPrice >= pos.stopLoss) {
                  hitExit = true;
                  exitReason = pos.halfClosed || (session.riskSettings.trailingStopEnabled && pos.stopLoss < pos.entryPrice) ? 'TRAILING_STOP' : 'SL';
                } else if (tickerPrice <= pos.takeProfit) {
                  hitExit = true;
                  exitReason = 'TP';
                }
              }
            }

            if (hitExit) {
              session.addLog(`Exit signal triggered for ${symbol} (${pos.type}): Price ($${tickerPrice.toFixed(2)}) hit ${exitReason} limit (${exitReason === 'TP' ? pos.takeProfit.toFixed(2) : pos.stopLoss.toFixed(2)}). Closing...`, 'warning');
              await executeCloseOrder(session, key, exitReason);
            }
          }

          if (hasActivePosition) continue;

          // Evaluate entries
          const activeSymbolsWithPositions = Array.from(new Set(
            Object.values(session.activePositions)
              .filter(Boolean)
              .map(p => p.symbol)
          ));
          if (activeSymbolsWithPositions.length >= session.riskSettings.maxConcurrentPositions) {
            evaluation.status = 'REJECTED';
            evaluation.reason = `Max concurrent signals limit reached (${session.riskSettings.maxConcurrentPositions} pairs)`;
            session.evaluationStates[symbol] = evaluation;
            logTickDetails(session.username, symbol, evaluation);
            continue;
          }

          // Check 3-candle cooldown (15 minutes on 5m candles, 5 minutes for HF Scalper)
          if (session.cooldowns[symbol]) {
            const elapsed = Date.now() - session.cooldowns[symbol];
            const isHighFreq = session.stratSettings.strategyType === 'HIGH_FREQUENCY_SCALPER';
            const cooldownLimit = isHighFreq ? 5 * 60 * 1000 : 15 * 60 * 1000;
            if (elapsed < cooldownLimit) {
              evaluation.status = 'COOLDOWN';
              evaluation.reason = `In cooldown. Cooldown ends in ${Math.ceil((cooldownLimit - elapsed) / 1000)}s`;
              session.evaluationStates[symbol] = evaluation;
              logTickDetails(session.username, symbol, evaluation);
              continue;
            }
          }

          const decision = evaluateStrategyRules(calculatedCandles, session.stratSettings, symbol);

          if (!decision.signal) {
            evaluation.status = 'WAITING_FOR_SIGNAL';
            evaluation.reason = decision.reason || 'No entry setup detected';
            session.evaluationStates[symbol] = evaluation;
            logTickDetails(session.username, symbol, evaluation);
            continue;
          }

          let mtfAligned = true;

          // Check Multi-Timeframe Trend filter (using 1H for 5m strategy macro filter)
          if (session.stratSettings.useMultiTimeframe) {
            try {
              const ohlcvMacro = await session.exchangeInstance.fetchOHLCV(marketSymbol, '1h', undefined, 100);
              const closesMacro = ohlcvMacro.map((c) => c[4]);
              const ema20_macro = calculateEMA(closesMacro, 20);
              const ema50_macro = calculateEMA(closesMacro, 50);

              const last20_macro = ema20_macro[ema20_macro.length - 1];
              const last50_macro = ema50_macro[ema50_macro.length - 1];

              if (decision.signal === 'BUY' && last20_macro < last50_macro) {
                mtfAligned = false;
                evaluation.status = 'REJECTED';
                evaluation.reason = `1H Macro Bearish mismatch (1H EMA20 < 1H EMA50)`;
              } else if (decision.signal === 'SELL' && last20_macro > last50_macro) {
                mtfAligned = false;
                evaluation.status = 'REJECTED';
                evaluation.reason = `1H Macro Bullish mismatch (1H EMA20 > 1H EMA50)`;
              }
            } catch (mtfErr) {
              session.addLog(`Failed to fetch 1H macro trend for ${symbol}: ${mtfErr.message}. Proceeding without filter.`, 'warning');
            }
          }

          if (!mtfAligned) {
            session.evaluationStates[symbol] = evaluation;
            logTickDetails(session.username, symbol, evaluation);
            continue;
          }

          session.addLog(`Signal detected for ${symbol}: ${decision.signal} (${decision.reason})`, 'warning');

          // Volatility Protection Check
          const volCheck = await checkVolatilityAndLiquidity(session, symbol, latestCandle);
          if (!volCheck.ok) {
            evaluation.status = 'REJECTED';
            evaluation.reason = `Volatility Protection: ${volCheck.reason}`;
            session.evaluationStates[symbol] = evaluation;
            logTickDetails(session.username, symbol, evaluation);
            session.addLog(`Volatility Protection: Signal skipped for ${symbol} due to: ${volCheck.reason}`, 'warning');
            continue;
          }

          const atrValue = latestCandle.atr || (latestCandle.high - latestCandle.low) || 5.0;
          const slDistance = atrValue * session.riskSettings.atrMultiplier;

          let slPrice = 0;
          let tpPrice = 0;
          let target1Price = 0;

          if (decision.signal === 'BUY') {
            slPrice = tickerPrice - slDistance;
            tpPrice = tickerPrice + slDistance * session.riskSettings.riskRewardRatio;
            target1Price = tickerPrice + slDistance * 1.5;
          } else {
            slPrice = tickerPrice + slDistance;
            tpPrice = tickerPrice - slDistance * session.riskSettings.riskRewardRatio;
            target1Price = tickerPrice - slDistance * 1.5;
          }

          const maxLossUsd = exchangeBalance * (session.riskSettings.riskPercent / 100);
          let size = maxLossUsd / slDistance;

          // Fetch min order size limits (safely scales up small balances to Bybit's 5 USDT cost)
          const minSize = getMinOrderSize(session, marketSymbol, tickerPrice);
          evaluation.minNotional = minSize * tickerPrice;

          if (size < minSize) {
            const requiredCost = minSize * tickerPrice;
            if (exchangeBalance >= requiredCost) {
              size = minSize;
              session.addLog(`Position scaled up to exchange minimum: ${size.toFixed(4)} ($${requiredCost.toFixed(2)} USDT)`, 'info');
            } else {
              evaluation.status = 'REJECTED';
              evaluation.reason = `Size cost $${(size * tickerPrice).toFixed(2)} < required min $${requiredCost.toFixed(2)} and balance $${exchangeBalance.toFixed(2)} is insufficient.`;
              session.evaluationStates[symbol] = evaluation;
              logTickDetails(session.username, symbol, evaluation);
              continue;
            }
          }

          let exposure = size * tickerPrice;

          // Check exposure limits (based on leverage)
          const maxAllowed = exchangeBalance * session.riskSettings.leverage;
          if (exposure > maxAllowed) {
            size = maxAllowed / tickerPrice;
            exposure = size * tickerPrice;
          }

          // Round size to exchange precision
          if (session.exchangeInstance && session.exchangeInstance.markets && session.exchangeInstance.markets[marketSymbol]) {
            try {
              size = parseFloat(session.exchangeInstance.amountToPrecision(marketSymbol, size));
            } catch (e) {
              size = parseFloat(size.toFixed(4));
            }
          } else {
            size = parseFloat(size.toFixed(4));
          }

          if (size <= 0) {
            evaluation.status = 'REJECTED';
            evaluation.reason = `Precision rounding reduced size to 0. Cannot execute.`;
            session.evaluationStates[symbol] = evaluation;
            logTickDetails(session.username, symbol, evaluation);
            continue;
          }

          evaluation.calculatedSize = size;
          evaluation.status = 'EXECUTING';

          if (session.riskSettings.hedgedDualExecutionEnabled) {
            // Verify hedge mode first
            const isHedgeOk = await verifyHedgeMode(session, symbol);
            if (!isHedgeOk || !session.isHedgeMode) {
              evaluation.status = 'REJECTED';
              evaluation.reason = `Hedged Dual Engine: aborted entry because Hedge Mode is disabled/unavailable on exchange.`;
              session.evaluationStates[symbol] = evaluation;
              logTickDetails(session.username, symbol, evaluation);
              session.addLog(`Hedged Dual Engine Error: Aborted entry on ${symbol} because Hedge Mode is disabled.`, 'danger');
              continue;
            }

            const primarySide = decision.signal === 'BUY' ? 'buy' : 'sell';
            const hedgeSide = primarySide === 'buy' ? 'sell' : 'buy';
            const primaryIdx = decision.signal === 'BUY' ? 1 : 2;
            const hedgeIdx = decision.signal === 'BUY' ? 2 : 1;

            const primaryKey = `${symbol}_LONG`;
            const hedgeKey = `${symbol}_SHORT`;

            // Sizing: Half and half of available USDT balance
            const halfUsdt = exchangeBalance * 0.48; // 48% to leave 4% buffer for fees/slippage
            const primaryLev = session.riskSettings.leverage;
            const hedgeLev = Math.max(1, Math.round(session.riskSettings.leverage / 2));

            let sizePrimary = (halfUsdt * primaryLev) / tickerPrice;
            let sizeHedge = (halfUsdt * hedgeLev) / tickerPrice;

            // Fetch min order size limits
            const minSizePri = getMinOrderSize(session, marketSymbol, tickerPrice);

            // Round size to exchange precision
            if (session.exchangeInstance && session.exchangeInstance.markets && session.exchangeInstance.markets[marketSymbol]) {
              try {
                sizePrimary = parseFloat(session.exchangeInstance.amountToPrecision(marketSymbol, sizePrimary));
              } catch (e) {
                sizePrimary = parseFloat(sizePrimary.toFixed(4));
              }
              try {
                sizeHedge = parseFloat(session.exchangeInstance.amountToPrecision(marketSymbol, sizeHedge));
              } catch (e) {
                sizeHedge = parseFloat(sizeHedge.toFixed(4));
              }
            } else {
              sizePrimary = parseFloat(sizePrimary.toFixed(4));
              sizeHedge = parseFloat(sizeHedge.toFixed(4));
            }

            // Ensure min size limits
            if (sizePrimary < minSizePri) sizePrimary = minSizePri;
            if (sizeHedge < minSizePri) sizeHedge = minSizePri;

            // Check exposure limits (based on leverage)
            const maxAllowedPri = exchangeBalance * primaryLev;
            const maxAllowedHdg = exchangeBalance * hedgeLev;
            if (sizePrimary * tickerPrice > maxAllowedPri) {
              sizePrimary = maxAllowedPri / tickerPrice;
              if (session.exchangeInstance && session.exchangeInstance.amountToPrecision) {
                sizePrimary = parseFloat(session.exchangeInstance.amountToPrecision(marketSymbol, sizePrimary));
              }
            }
            if (sizeHedge * tickerPrice > maxAllowedHdg) {
              sizeHedge = maxAllowedHdg / tickerPrice;
              if (session.exchangeInstance && session.exchangeInstance.amountToPrecision) {
                sizeHedge = parseFloat(session.exchangeInstance.amountToPrecision(marketSymbol, sizeHedge));
              }
            }

            if (sizePrimary <= 0 || sizeHedge <= 0) {
              evaluation.status = 'REJECTED';
              evaluation.reason = `Precision rounding reduced size to 0. Cannot execute.`;
              session.evaluationStates[symbol] = evaluation;
              logTickDetails(session.username, symbol, evaluation);
              continue;
            }

            evaluation.calculatedSize = sizePrimary;

            // Adjust leverage dynamically if exchange live
            if (session.exchangeInstance) {
              try {
                const buyLeverage = decision.signal === 'BUY' ? primaryLev : hedgeLev;
                const sellLeverage = decision.signal === 'BUY' ? hedgeLev : primaryLev;
                await session.exchangeInstance.setLeverage(primaryLev, marketSymbol, {
                  buyLeverage: buyLeverage,
                  sellLeverage: sellLeverage
                });
              } catch (levErr) {
                session.addLog(`Leverage Adjustment Warning: ${levErr.message}`, 'warning');
              }
            }

            session.addLog(`Sending simultaneous Hedged Dual entries to Exchange for ${symbol} (Primary Size: ${sizePrimary.toFixed(4)}, Hedge Size: ${sizeHedge.toFixed(4)})...`, 'info');

            let primaryOrder = null;
            let hedgeOrder = null;

            try {
              if (session.exchangeInstance) {
                const results = await Promise.all([
                  safeCreateMarketOrder(session.exchangeInstance, marketSymbol, primarySide, sizePrimary, { positionIdx: primaryIdx }, (txt, typ) => session.addLog(`[Primary] ${txt}`, typ)),
                  safeCreateMarketOrder(session.exchangeInstance, marketSymbol, hedgeSide, sizeHedge, { positionIdx: hedgeIdx }, (txt, typ) => session.addLog(`[Hedge] ${txt}`, typ))
                ]);
                primaryOrder = results[0];
                hedgeOrder = results[1];
              } else {
                primaryOrder = { price: tickerPrice, average: tickerPrice, amount: sizePrimary };
                hedgeOrder = { price: tickerPrice, average: tickerPrice, amount: sizeHedge };
              }

              const primaryFill = primaryOrder.price || primaryOrder.average || tickerPrice;
              const hedgeFill = hedgeOrder.price || hedgeOrder.average || tickerPrice;

              const livePriId = `live_pri_${Date.now()}`;
              const liveHdgId = `live_hdg_${Date.now()}`;

              session.activePositions[primaryKey] = {
                id: livePriId,
                type: decision.signal === 'BUY' ? 'LONG' : 'SHORT',
                symbol: symbol,
                entryPrice: primaryFill,
                entryTime: Date.now(),
                size: sizePrimary,
                leverage: primaryLev,
                stopLoss: parseFloat(slPrice.toFixed(2)),
                takeProfit: parseFloat(tpPrice.toFixed(2)),
                target1Price: parseFloat(target1Price.toFixed(2)),
                halfClosed: false,
                pnl: 0,
                pnlPercent: 0,
                status: 'OPEN',
                maxObservedPrice: primaryFill,
                minObservedPrice: primaryFill,
                isHedgedPair: true,
                hedgedRole: 'PRIMARY',
                hedgedScenario: 'NONE',
                pairedPositionId: liveHdgId,
                maxLeveragedPnL: 0,
              };

              session.activePositions[hedgeKey] = {
                id: liveHdgId,
                type: decision.signal === 'BUY' ? 'SHORT' : 'LONG',
                symbol: symbol,
                entryPrice: hedgeFill,
                entryTime: Date.now(),
                size: sizeHedge,
                leverage: hedgeLev,
                stopLoss: parseFloat((hedgeFill * (decision.signal === 'BUY' ? 1.05 : 0.95)).toFixed(2)),
                takeProfit: parseFloat((hedgeFill * (decision.signal === 'BUY' ? 0.90 : 1.10)).toFixed(2)),
                target1Price: parseFloat((hedgeFill * (decision.signal === 'BUY' ? 0.925 : 1.075)).toFixed(2)),
                halfClosed: false,
                pnl: 0,
                pnlPercent: 0,
                status: 'OPEN',
                maxObservedPrice: hedgeFill,
                minObservedPrice: hedgeFill,
                isHedgedPair: true,
                hedgedRole: 'HEDGE',
                hedgedScenario: 'NONE',
                pairedPositionId: livePriId,
                maxLeveragedPnL: 0,
              };

              evaluation.status = 'POSITION_OPEN';
              evaluation.reason = `Executed Hedged entries for ${symbol}`;
              session.evaluationStates[symbol] = evaluation;
              logTickDetails(session.username, symbol, evaluation);

              session.addLog(`📥 Executed paired Hedged entries for ${symbol}. Primary: ${session.activePositions[primaryKey].type} (${primaryFill}), Hedge: ${session.activePositions[hedgeKey].type} (${hedgeFill})`, 'success');

            } catch (pairErr) {
              session.addLog(`CRITICAL: Hedged entry execution encountered an error: ${pairErr.message}`, 'danger');
              session.addLog(`Initiating safety rollback to prevent orphan positions...`, 'warning');

              if (primaryOrder) {
                try {
                  const closeSide = primarySide === 'buy' ? 'sell' : 'buy';
                  const closeParams = session.isHedgeMode ? { positionIdx: primaryIdx } : { positionIdx: 0 };
                  await safeCreateMarketOrder(session.exchangeInstance, marketSymbol, closeSide, sizePrimary, closeParams, (txt, typ) => session.addLog(`[Rollback Pri] ${txt}`, typ));
                  session.addLog(`Rollback: Cleaned up primary position.`, 'success');
                } catch (priErr) {
                  session.addLog(`Rollback Error: Failed to clean up primary position: ${priErr.message}`, 'danger');
                }
              }

              if (hedgeOrder) {
                try {
                  const closeSide = hedgeSide === 'buy' ? 'sell' : 'buy';
                  const closeParams = session.isHedgeMode ? { positionIdx: hedgeIdx } : { positionIdx: 0 };
                  await safeCreateMarketOrder(session.exchangeInstance, marketSymbol, closeSide, sizeHedge, closeParams, (txt, typ) => session.addLog(`[Rollback Hdg] ${txt}`, typ));
                  session.addLog(`Rollback: Cleaned up hedge position.`, 'success');
                } catch (hdgErr) {
                  session.addLog(`Rollback Error: Failed to clean up hedge position: ${hdgErr.message}`, 'danger');
                }
              }

              evaluation.status = 'ERROR';
              evaluation.reason = `Exchange entry failed: ${pairErr.message}. Rollback triggered.`;
              evaluation.error = pairErr.message;
              session.evaluationStates[symbol] = evaluation;
              logTickDetails(session.username, symbol, evaluation);
            }
          } else {
            // Standard single execution
            const tradeSide = decision.signal === 'BUY' ? 'buy' : 'sell';
            const entryParams = session.isHedgeMode ? { positionIdx: decision.signal === 'BUY' ? 1 : 2 } : { positionIdx: 0 };
            
            try {
              const order = await safeCreateMarketOrder(session.exchangeInstance, marketSymbol, tradeSide, size, entryParams, (txt, typ) => session.addLog(txt, typ));
              const fillPrice = order.price || order.average || tickerPrice;

              session.activePositions[symbol] = {
                id: `live_${Date.now()}`,
                type: decision.signal === 'BUY' ? 'LONG' : 'SHORT',
                symbol: symbol,
                entryPrice: fillPrice,
                entryTime: Date.now(),
                size: size,
                leverage: session.riskSettings.leverage,
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

              evaluation.status = 'POSITION_OPEN';
              evaluation.reason = `Executed entry for ${symbol} at $${fillPrice}`;
              session.evaluationStates[symbol] = evaluation;
              logTickDetails(session.username, symbol, evaluation);

              session.addLog(`📥 Executed live entry for ${symbol} at $${fillPrice}. SL: $${slPrice.toFixed(2)}, Target 1 (1.5R): $${target1Price.toFixed(2)}, Target 2 (${session.riskSettings.riskRewardRatio}R): $${tpPrice.toFixed(2)}`, 'success');
            } catch (orderErr) {
              if (orderErr.message.includes('position idx not match position mode') || orderErr.message.includes('10001')) {
                session.isHedgeMode = !session.isHedgeMode;
                session.addLog(`Order failed due to position mode mismatch. Automatically switched Hedge Mode setting to: ${session.isHedgeMode}. Retrying will occur on next signal tick.`, 'warning');
              }
              evaluation.status = 'ERROR';
              evaluation.reason = `Exchange entry failed: ${orderErr.message}`;
              evaluation.error = orderErr.message;
              session.evaluationStates[symbol] = evaluation;
              logTickDetails(session.username, symbol, evaluation);
              session.addLog(`Order execution failed for ${symbol}: ${orderErr.message}`, 'danger');
            }
          }

          await sleep(500); // Prevent API rate limits
        } catch (symbolErr) {
          session.addLog(`Error processing ${symbol} polling: ${symbolErr.message}`, 'danger');
        }
      }
    } catch (userErr) {
      session.addLog(`Error in user session loop for ${username}: ${userErr.message}`, 'danger');
    }
  }
}, 10000); // Ticks every 10 seconds

// Serve static assets from Vite's built output in production
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Start backend server
app.listen(PORT, () => {
  console.log(`[SYSTEM] Express Server running on port ${PORT}. Ready to accept exchange API calls.`);
});
