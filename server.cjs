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
  const safeName = username.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(DB_DIR, `${safeName}.json`);
}

function saveUserProfile(profile) {
  const userPath = getUserPath(profile.username);
  fs.writeFileSync(userPath, JSON.stringify(profile, null, 2));
}

function loadUserProfile(username) {
  const userPath = getUserPath(username);
  if (!fs.existsSync(userPath)) return null;
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
    activeSymbols: profile.activeSymbols || ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
    activePositions: {},
    closedTrades: profile.closedTrades || [],
    botLogs: [],
    lastTickPrices: {},
    candlesMap: {},
    dailyStartEquity: null,
    lastCircuitBreakerCheckDate: '',
    circuitBreakerTriggered: false,
    cooldowns: {}, // symbol -> timestamp of exit
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
          });
          if (creds.isTestnet && session.exchangeInstance.setSandboxMode) {
            session.exchangeInstance.setSandboxMode(true);
          }
          session.connectionStatus = 'CONNECTED';
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
        const username = file.replace('.json', '');
        const profile = loadUserProfile(username);
        if (profile && profile.botActive) {
          getOrCreateSession(username);
          loadedCount++;
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

// Evaluate Strategy Entry Signals
function evaluateStrategyRules(candlesList, stratSettings) {
  const len = candlesList.length;
  if (len < 5) return { signal: null };

  const current = candlesList[len - 1];
  const previous = candlesList[len - 2];

  if (stratSettings.strategyType === 'TREND_FOLLOWING') {
    const { ema20, ema50, ema200, rsi, adx } = current;
    const { ema20: emaShortPrev, ema50: emaLongPrev } = previous;
    
    if (!ema20 || !ema50 || !ema200 || !emaShortPrev || !emaLongPrev || !rsi || !adx) return { signal: null };

    // Enforce stricter ADX check
    if (adx < stratSettings.adxThreshold) return { signal: null };

    // Golden Cross
    if (emaShortPrev <= emaLongPrev && ema20 > ema50) {
      if (current.close > ema200 && rsi < stratSettings.rsiOverbought) {
        // Strict VWAP limit - close or below fair value
        if (current.vwap && current.close <= current.vwap * 1.002) {
          return { signal: 'BUY', reason: `EMA Golden Cross with RSI & VWAP entry confirmation (ADX: ${adx.toFixed(1)} > ${stratSettings.adxThreshold})` };
        }
      }
    }
    // Death Cross
    if (emaShortPrev >= emaLongPrev && ema20 < ema50) {
      if (current.close < ema200 && rsi > stratSettings.rsiOversold) {
        // Strict VWAP limit - close or above fair value
        if (current.vwap && current.close >= current.vwap * 0.998) {
          return { signal: 'SELL', reason: `EMA Death Cross with RSI & VWAP entry confirmation (ADX: ${adx.toFixed(1)} > ${stratSettings.adxThreshold})` };
        }
      }
    }
  } else if (stratSettings.strategyType === 'MEAN_REVERSION') {
    const { bbLower, bbUpper, rsi } = current;
    const { bbLower: bbLowerPrev, bbUpper: bbUpperPrev } = previous;
    
    if (!bbLower || !bbUpper || !bbLowerPrev || !bbUpperPrev || !rsi) return { signal: null };

    // Enforce 25/75 RSI boundaries and VWAP constraints
    if ((current.close <= bbLower || previous.close <= bbLowerPrev) && rsi <= stratSettings.rsiOversold) {
      if (current.vwap && current.close <= current.vwap) {
        return { signal: 'BUY', reason: `Mean Reversion Buy: BB rejection & RSI oversold (${rsi.toFixed(1)} <= ${stratSettings.rsiOversold}) below VWAP` };
      }
    }
    if ((current.close >= bbUpper || previous.close >= bbUpperPrev) && rsi >= stratSettings.rsiOverbought) {
      if (current.vwap && current.close >= current.vwap) {
        return { signal: 'SELL', reason: `Mean Reversion Sell: BB rejection & RSI overbought (${rsi.toFixed(1)} >= ${stratSettings.rsiOverbought}) above VWAP` };
      }
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
    
    const { atr, vwap } = current;
    const { atr: atrPrev } = previous;
    if (!atr || !atrPrev) return { signal: null };

    if (current.close > highestHigh && current.volume > avgVol * 1.3 && atr > atrPrev) {
      if (vwap && current.close > vwap) {
        return { signal: 'BUY', reason: 'High breakout with volume & ATR expansion above VWAP' };
      }
    }
    if (current.close < lowestLow && current.volume > avgVol * 1.3 && atr > atrPrev) {
      if (vwap && current.close < vwap) {
        return { signal: 'SELL', reason: 'Low breakout with volume & ATR expansion below VWAP' };
      }
    }
  }

  return { signal: null };
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
    return res.status(400).json({ success: false, error: 'Username and password are required.' });
  }

  const sanitized = username.replace(/[^a-zA-Z0-9_-]/g, '');
  if (sanitized !== username || username.length < 3) {
    return res.status(400).json({ success: false, error: 'Username must be at least 3 characters and contain only letters, numbers, hyphens, and underscores.' });
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
    activeSymbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
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
    });

    if (isTestnet && testExchange.setSandboxMode) {
      testExchange.setSandboxMode(true);
    }

    // Fetch balance to validate the API key works
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
  if (clientSymbol && session.activeSymbols.includes(clientSymbol)) {
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
async function executeCloseOrder(session, symbol, reason, customSize = null) {
  const pos = session.activePositions[symbol];
  if (!pos) return;

  const closeSide = pos.type === 'LONG' ? 'sell' : 'buy';
  const sizeToClose = customSize !== null ? customSize : pos.size;
  const tickerPrice = session.lastTickPrices[symbol] || pos.entryPrice;

  session.addLog(`Sending Close Order (${closeSide.toUpperCase()}) on Exchange for ${sizeToClose.toFixed(4)} ${symbol.split('/')[0]}...`, 'info');

  try {
    let fillPrice = tickerPrice;

    if (session.exchangeInstance) {
      // Place real market order on exchange to close
      const order = await session.exchangeInstance.createMarketOrder(symbol, closeSide, sizeToClose);
      fillPrice = order.price || order.average || tickerPrice;
      session.addLog(`Exchange Fill success for ${symbol}. Closed size ${sizeToClose.toFixed(4)} at average price $${fillPrice}.`, 'success');
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
      session.activePositions[symbol] = null;

      // Track the exit timestamp for the 3-candle cooldown
      session.cooldowns[symbol] = Date.now();

      // Save closedTrades to profile db
      const profile = loadUserProfile(session.username);
      if (profile) {
        profile.closedTrades = session.closedTrades;
        saveUserProfile(profile);
      }

      const summaryMsg = pnl >= 0
        ? `📈 Trade Closed [${reason}] for ${symbol}: Profit: +$${pnl.toFixed(2)} (${closedPos.pnlPercent.toFixed(2)}%)`
        : `📉 Trade Closed [${reason}] for ${symbol}: Loss: -$${Math.abs(pnl).toFixed(2)} (${closedPos.pnlPercent.toFixed(2)}%)`;

      session.addLog(summaryMsg, pnl >= 0 ? 'success' : 'danger');
    }
  } catch (err) {
    session.addLog(`Failed to close position on exchange for ${symbol}: ${err.message}`, 'danger');
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
      let drawdownPercent = 0;
      if (session.dailyStartEquity && session.dailyStartEquity > 0) {
        const pnl = currentEquity - session.dailyStartEquity;
        if (pnl < 0) {
          drawdownPercent = (Math.abs(pnl) / session.dailyStartEquity) * 100;
        }
      }

      // Circuit Breaker activation
      if (drawdownPercent >= session.riskSettings.maxDailyDrawdown && !session.circuitBreakerTriggered) {
        session.circuitBreakerTriggered = true;
        session.botActive = false;
        session.addLog(`[CRITICAL] Daily Max Drawdown limit (${session.riskSettings.maxDailyDrawdown}%) hit! (Current: -${drawdownPercent.toFixed(2)}%). Triggering Emergency Circuit Breaker.`, 'danger');

        // Save status to db
        const profile = loadUserProfile(session.username);
        if (profile) {
          profile.botActive = false;
          saveUserProfile(profile);
        }

        // Close all active positions
        for (const sym of session.activeSymbols) {
          if (session.activePositions[sym]) {
            session.addLog(`Circuit Breaker: Market closing position for ${sym}...`, 'warning');
            await executeCloseOrder(session, sym, 'DRAWDOWN');
          }
        }
        continue;
      }

      if (session.circuitBreakerTriggered || !session.botActive) continue;

      // 3. Process portfolio symbols sequentially (respect rate limits)
      for (const symbol of session.activeSymbols) {
        try {
          const timeframe = '5m';
          const ohlcv = await session.exchangeInstance.fetchOHLCV(symbol, timeframe, undefined, 100);

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

          // Check active position updates
          const pos = session.activePositions[symbol];
          if (pos) {
            // Update peak/valley
            if (pos.type === 'LONG') {
              pos.maxObservedPrice = Math.max(pos.maxObservedPrice || pos.entryPrice, tickerPrice);
            } else {
              pos.minObservedPrice = Math.min(pos.minObservedPrice || pos.entryPrice, tickerPrice);
            }

            // Partial scale out check
            if (session.riskSettings.partialTakeProfitEnabled && !pos.halfClosed) {
              let target1Hit = false;
              if (pos.type === 'LONG' && tickerPrice >= pos.target1Price) {
                target1Hit = true;
              } else if (pos.type === 'SHORT' && tickerPrice <= pos.target1Price) {
                target1Hit = true;
              }

              if (target1Hit) {
                session.addLog(`🎯 Target 1 (1.5R) hit for ${symbol} at $${pos.target1Price.toFixed(2)}. Closing 50% size.`, 'success');
                await executeCloseOrder(session, symbol, 'TP', pos.size / 2);
                
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

            // Trailing stop checks
            if (session.riskSettings.trailingStopEnabled && !pos.halfClosed) {
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

            if (hitExit) {
              session.addLog(`Exit signal triggered for ${symbol}: Price ($${tickerPrice.toFixed(2)}) hit ${exitReason} limit (${exitReason === 'TP' ? pos.takeProfit.toFixed(2) : pos.stopLoss.toFixed(2)}). Closing...`, 'warning');
              await executeCloseOrder(session, symbol, exitReason);
            }
          }

          // Evaluate entries
          const openCount = Object.values(session.activePositions).filter(Boolean).length;
          if (!pos && openCount < session.riskSettings.maxConcurrentPositions) {
            // Check 3-candle cooldown (15 minutes on 5m candles)
            if (session.cooldowns[symbol]) {
              const elapsed = Date.now() - session.cooldowns[symbol];
              const cooldownLimit = 15 * 60 * 1000; // 3 candles * 5 minutes
              if (elapsed < cooldownLimit) {
                // Still in cooldown
                continue;
              }
            }

            const decision = evaluateStrategyRules(calculatedCandles, session.stratSettings);

            if (decision.signal) {
              let mtfAligned = true;

              // Check Multi-Timeframe Trend filter (using 1H for 5m strategy macro filter)
              if (session.stratSettings.useMultiTimeframe) {
                try {
                  const ohlcvMacro = await session.exchangeInstance.fetchOHLCV(symbol, '1h', undefined, 50);
                  const closesMacro = ohlcvMacro.map((c) => c[4]);
                  const ema20_macro = calculateEMA(closesMacro, 20);
                  const ema50_macro = calculateEMA(closesMacro, 50);

                  const last20_macro = ema20_macro[ema20_macro.length - 1];
                  const last50_macro = ema50_macro[ema50_macro.length - 1];

                  if (decision.signal === 'BUY' && last20_macro < last50_macro) {
                    mtfAligned = false;
                    session.addLog(`Ignored BUY for ${symbol}: 1H Macro trend is bearish (1H EMA20 < 1H EMA50)`, 'info');
                  } else if (decision.signal === 'SELL' && last20_macro > last50_macro) {
                    mtfAligned = false;
                    session.addLog(`Ignored SELL for ${symbol}: 1H Macro trend is bullish (1H EMA20 > 1H EMA50)`, 'info');
                  }
                } catch (mtfErr) {
                  session.addLog(`Failed to fetch 1H macro trend for ${symbol}: ${mtfErr.message}. Proceeding without filter.`, 'warning');
                }
              }

              if (mtfAligned) {
                session.addLog(`Signal detected for ${symbol}: ${decision.signal} (${decision.reason})`, 'warning');

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

                const exposure = size * tickerPrice;
                const maxAllowed = exchangeBalance * session.riskSettings.leverage;
                if (exposure > maxAllowed) {
                  size = maxAllowed / tickerPrice;
                }

                const tradeSide = decision.signal === 'BUY' ? 'buy' : 'sell';
                session.addLog(`Sending Entry Order (${tradeSide.toUpperCase()}) for ${size.toFixed(4)} ${symbol} to Exchange...`, 'info');

                const order = await session.exchangeInstance.createMarketOrder(symbol, tradeSide, size);
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

                session.addLog(`📥 Executed live entry for ${symbol} at $${fillPrice}. SL: $${slPrice.toFixed(2)}, Target 1 (1.5R): $${target1Price.toFixed(2)}, Target 2 (${session.riskSettings.riskRewardRatio}R): $${tpPrice.toFixed(2)}`, 'success');
              }
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
