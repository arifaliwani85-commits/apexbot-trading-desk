import React, { useState } from 'react';
import type { StrategySettings, RiskSettings, StrategyType } from '../types';
import { Shield, Settings, Sliders, Info, Server, Cpu, Key } from 'lucide-react';

interface StrategyConfigProps {
  stratSettings: StrategySettings;
  setStratSettings: React.Dispatch<React.SetStateAction<StrategySettings>>;
  riskSettings: RiskSettings;
  setRiskSettings: React.Dispatch<React.SetStateAction<RiskSettings>>;
  botActive: boolean;
  setBotActive: (active: boolean) => void;
  showIndicators: {
    ema20: boolean;
    ema50: boolean;
    ema200: boolean;
    bb: boolean;
  };
  setShowIndicators: React.Dispatch<React.SetStateAction<{
    ema20: boolean;
    ema50: boolean;
    ema200: boolean;
    bb: boolean;
  }>>;
  // Exchange Props
  botMode: 'MOCK_SIMULATOR' | 'EXCHANGE_LIVE';
  setBotMode: (mode: 'MOCK_SIMULATOR' | 'EXCHANGE_LIVE') => void;
  exchangeStatus: {
    connected: boolean;
    exchangeId: string;
    isTestnet: boolean;
    balance: number;
    equity?: number;
    dailyDrawdownPercent?: number;
    circuitBreakerTriggered?: boolean;
    maskedApiKey?: string;
    maskedApiSecret?: string;
  };
  onConnectExchange: (exchangeId: string, apiKey: string, apiSecret: string, isTestnet: boolean) => Promise<boolean>;
  onDisconnectExchange: () => void;
  symbol: string;
  setSymbol: (s: string) => void;
  hasUnappliedChanges?: boolean;
}

export const StrategyConfig: React.FC<StrategyConfigProps> = ({
  stratSettings,
  setStratSettings,
  riskSettings,
  setRiskSettings,
  botActive,
  setBotActive,
  showIndicators,
  setShowIndicators,
  botMode,
  setBotMode,
  exchangeStatus,
  onConnectExchange,
  onDisconnectExchange,
  symbol,
  setSymbol,
  hasUnappliedChanges = false,
}) => {
  const [exchangeId, setExchangeId] = useState('binance');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [isTestnet, setIsTestnet] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  React.useEffect(() => {
    if (!exchangeStatus.connected) {
      setIsEditing(false);
    }
  }, [exchangeStatus.connected]);

  const handleEditClick = () => {
    setExchangeId(exchangeStatus.exchangeId || 'binance');
    setIsTestnet(exchangeStatus.isTestnet !== false);
    setApiKey(exchangeStatus.maskedApiKey || '');
    setApiSecret(exchangeStatus.maskedApiSecret || '');
    setIsEditing(false); // Reset editing first to refresh form
    setTimeout(() => setIsEditing(true), 0);
  };

  const handleStrategyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setStratSettings((prev) => ({
      ...prev,
      strategyType: e.target.value as StrategyType,
    }));
  };

  const handleStratParamChange = (param: keyof StrategySettings, value: any) => {
    setStratSettings((prev) => ({
      ...prev,
      [param]: value,
    }));
  };

  const handleRiskParamChange = (param: keyof RiskSettings, value: any) => {
    setRiskSettings((prev) => ({
      ...prev,
      [param]: value,
    }));
  };

  const toggleIndicator = (key: keyof typeof showIndicators) => {
    setShowIndicators((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey || !apiSecret) {
      setErrorMessage('API Key and Secret are required.');
      return;
    }
    setErrorMessage('');
    setConnecting(true);
    try {
      const ok = await onConnectExchange(exchangeId, apiKey, apiSecret, isTestnet);
      if (ok) {
        setApiKey('');
        setApiSecret('');
      } else {
        setErrorMessage('Failed to connect. Check exchange details or api key permission.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Connection failed.');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="sidebar" style={{ height: '100%', overflowY: 'auto' }}>
      {/* Bot Mode Switcher */}
      <div className="sidebar-section" style={{ borderBottom: '1px solid var(--border-color)', padding: '16px' }}>
        <div style={{ display: 'flex', borderRadius: 'var(--radius-md)', background: 'var(--bg-tertiary)', padding: '3px', border: '1px solid var(--border-color)' }}>
          <button
            onClick={() => { setBotActive(false); setBotMode('MOCK_SIMULATOR'); }}
            style={{
              flex: 1,
              padding: '8px',
              fontSize: '11px',
              fontWeight: '600',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              background: botMode === 'MOCK_SIMULATOR' ? 'var(--accent-blue)' : 'transparent',
              color: botMode === 'MOCK_SIMULATOR' ? '#fff' : 'var(--text-secondary)',
              transition: 'all 0.2s',
            }}
          >
            <Cpu size={12} /> SIMULATOR
          </button>
          <button
            onClick={() => { setBotActive(false); setBotMode('EXCHANGE_LIVE'); }}
            style={{
              flex: 1,
              padding: '8px',
              fontSize: '11px',
              fontWeight: '600',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              background: botMode === 'EXCHANGE_LIVE' ? 'var(--accent-blue)' : 'transparent',
              color: botMode === 'EXCHANGE_LIVE' ? '#fff' : 'var(--text-secondary)',
              transition: 'all 0.2s',
            }}
          >
            <Server size={12} /> EXCHANGE LIVE
          </button>
        </div>
      </div>

      {/* Bot Active Start/Stop Switch */}
      <div className="sidebar-section">
        <button
          className={`btn ${botActive ? 'btn-danger' : 'btn-success'}`}
          onClick={() => setBotActive(!botActive)}
          disabled={botMode === 'EXCHANGE_LIVE' && !exchangeStatus.connected}
          style={{ opacity: botMode === 'EXCHANGE_LIVE' && !exchangeStatus.connected ? 0.5 : 1 }}
        >
          {botActive 
            ? (botMode === 'EXCHANGE_LIVE' ? 'STOP EXCHANGE BOT' : 'STOP SIMULATOR') 
            : (botMode === 'EXCHANGE_LIVE' ? 'START EXCHANGE BOT' : 'START SIMULATOR')}
        </button>
        {botMode === 'EXCHANGE_LIVE' && !exchangeStatus.connected && (
          <div style={{ fontSize: '10px', color: 'var(--accent-red)', marginTop: '6px', textAlign: 'center' }}>
            ⚠️ You must connect your API keys below first.
          </div>
        )}
        {hasUnappliedChanges && (
          <div style={{
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid var(--accent-gold)',
            color: 'var(--accent-gold)',
            borderRadius: 'var(--radius-md)',
            padding: '10px',
            fontSize: '12px',
            textAlign: 'center',
            fontWeight: 'bold',
            marginTop: '10px',
            boxShadow: '0 0 10px rgba(245, 158, 11, 0.15)',
          }}>
            ⚠️ Settings changed! Click "{botMode === 'EXCHANGE_LIVE' ? 'START EXCHANGE BOT' : 'START SIMULATOR'}" above to apply changes.
          </div>
        )}
      </div>

      {/* Live Exchange Credentials Panel */}
      {botMode === 'EXCHANGE_LIVE' && (
        <div className="sidebar-section" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <h3 className="section-heading">
            <Key size={16} className="blue-text" />
            Exchange API Configuration
          </h3>

          {exchangeStatus.connected && !isEditing ? (
            <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Status:</span>
                <span className="badge badge-long">CONNECTED</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Exchange:</span>
                <span style={{ textTransform: 'uppercase', fontWeight: 'bold' }}>{exchangeStatus.exchangeId}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Environment:</span>
                <span>{exchangeStatus.isTestnet ? 'Testnet paper trading' : 'Mainnet Real Trading'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-color)', paddingTop: '8px', marginTop: '8px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Account Balance:</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold', color: 'var(--accent-green)' }}>
                  ${exchangeStatus.balance.toFixed(2)} USDT
                </span>
              </div>
              {exchangeStatus.dailyDrawdownPercent !== undefined && (
                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dotted var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Daily Drawdown:</span>
                    <span style={{ color: exchangeStatus.dailyDrawdownPercent > 0 ? 'var(--accent-red)' : 'var(--text-secondary)', fontWeight: 'bold' }}>
                      {exchangeStatus.dailyDrawdownPercent.toFixed(2)}%
                    </span>
                  </div>
                  <div style={{ height: '4px', background: 'var(--bg-primary)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      background: exchangeStatus.dailyDrawdownPercent >= riskSettings.maxDailyDrawdown * 0.8 ? 'var(--accent-red)' : 'var(--accent-gold)',
                      width: `${Math.min(100, (exchangeStatus.dailyDrawdownPercent / riskSettings.maxDailyDrawdown) * 100)}%`,
                      transition: 'width 0.3s'
                    }}></div>
                  </div>
                  <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginTop: '4px', textAlign: 'right' }}>
                    Circuit Breaker Limit: {riskSettings.maxDailyDrawdown}%
                  </div>
                </div>
              )}
              {exchangeStatus.circuitBreakerTriggered && (
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--accent-red)', color: 'var(--accent-red)', borderRadius: 'var(--radius-sm)', padding: '6px', marginTop: '8px', fontSize: '10px', fontWeight: 'bold', textAlign: 'center' }}>
                  🚨 DAILY DRAWDOWN CIRCUIT BREAKER TRIGGERED! Bot deactivated.
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={handleEditClick}
                  className="btn btn-primary"
                  style={{
                    flex: 1,
                    padding: '8px',
                    fontSize: '11px',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  Change API / Exchange
                </button>
                <button
                  type="button"
                  onClick={onDisconnectExchange}
                  className="btn btn-secondary"
                  style={{
                    flex: 1,
                    padding: '8px',
                    fontSize: '11px',
                    background: 'rgba(239, 68, 68, 0.08)',
                    color: 'var(--accent-red)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleConnect} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div className="form-group" style={{ marginBottom: '8px' }}>
                <label className="form-label">Exchange ID</label>
                <select className="select-input" value={exchangeId} onChange={(e) => setExchangeId(e.target.value)}>
                  <option value="binance">Binance</option>
                  <option value="bybit">Bybit</option>
                  <option value="okx">OKX</option>
                  <option value="kraken">Kraken</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: '8px' }}>
                <label className="form-label">API Key</label>
                <input
                  type="password"
                  className="text-input"
                  placeholder="Paste Exchange API Key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>

              <div className="form-group" style={{ marginBottom: '8px' }}>
                <label className="form-label">API Secret</label>
                <input
                  type="password"
                  className="text-input"
                  placeholder="Paste API Secret"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                />
              </div>

              <div className="switch-group" style={{ marginBottom: '8px' }}>
                <span className="switch-label" style={{ cursor: 'pointer' }} onClick={() => setIsTestnet(!isTestnet)}>Use Testnet Sandbox</span>
                <label className="switch">
                  <input type="checkbox" checked={isTestnet} onChange={(e) => setIsTestnet(e.target.checked)} />
                  <span className="slider"></span>
                </label>
              </div>

              {errorMessage && (
                <div style={{ color: 'var(--accent-red)', fontSize: '11px', lineHeight: '1.4' }}>
                  ❌ {errorMessage}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px' }}>
                {exchangeStatus.connected && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setIsEditing(false)}
                    style={{ flex: 1, padding: '8px', fontSize: '11px' }}
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={connecting}
                  style={{ flex: exchangeStatus.connected ? 2 : 1 }}
                >
                  {connecting ? 'Validating...' : exchangeStatus.connected ? 'Save & Connect' : 'Connect to Exchange'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* 1. Risk Management Controls */}
      <div className="sidebar-section">
        <h3 className="section-heading">
          <Shield size={16} className="blue-text" />
          Risk Manager (Low-Loss Engine)
        </h3>
        
        {/* Risk Percentage Slider */}
        <div className="form-group">
          <label className="form-label">
            <span>Risk Per Trade:</span>
            <span className="val">{riskSettings.riskPercent}%</span>
          </label>
          <input
            type="range"
            min="0.25"
            max="3"
            step="0.25"
            className="range-input"
            value={riskSettings.riskPercent}
            onChange={(e) => handleRiskParamChange('riskPercent', parseFloat(e.target.value))}
          />
          <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Info size={10} /> Fits size so SL loss equals exactly {riskSettings.riskPercent}% of account.
          </div>
        </div>

        {/* Risk Reward Ratio (RRR) Slider */}
        <div className="form-group">
          <label className="form-label">
            <span>Risk-to-Reward (RRR):</span>
            <span className="val">1:{riskSettings.riskRewardRatio}</span>
          </label>
          <input
            type="range"
            min="1.5"
            max="4"
            step="0.5"
            className="range-input"
            value={riskSettings.riskRewardRatio}
            onChange={(e) => handleRiskParamChange('riskRewardRatio', parseFloat(e.target.value))}
          />
          <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Info size={10} /> Win 1 trade to offset {riskSettings.riskRewardRatio} losing trades.
          </div>
        </div>

        {/* Stop Loss Volatility Multiplier */}
        <div className="form-group">
          <label className="form-label">
            <span>ATR SL Multiplier:</span>
            <span className="val">{riskSettings.atrMultiplier}x</span>
          </label>
          <input
            type="range"
            min="1.5"
            max="3.5"
            step="0.1"
            className="range-input"
            value={riskSettings.atrMultiplier}
            onChange={(e) => handleRiskParamChange('atrMultiplier', parseFloat(e.target.value))}
          />
          <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Info size={10} /> Adjusts Stop Loss distance to asset volatility.
          </div>
        </div>

        {/* Leverage Select */}
        <div className="form-group">
          <label className="form-label">
            <span>Leverage:</span>
            <span className="val">{riskSettings.leverage}x</span>
          </label>
          <select
            className="select-input"
            value={riskSettings.leverage}
            onChange={(e) => handleRiskParamChange('leverage', parseInt(e.target.value))}
          >
            <option value="1">1x (No Leverage)</option>
            <option value="2">2x Leverage</option>
            <option value="5">5x Leverage</option>
            <option value="10">10x Leverage</option>
          </select>
        </div>

        {/* Max Concurrent Positions */}
        <div className="form-group">
          <label className="form-label">
            <span>Max Active Pairs:</span>
            <span className="val">{riskSettings.maxConcurrentPositions}</span>
          </label>
          <input
            type="range"
            min="1"
            max="5"
            step="1"
            className="range-input"
            value={riskSettings.maxConcurrentPositions}
            onChange={(e) => handleRiskParamChange('maxConcurrentPositions', parseInt(e.target.value))}
          />
        </div>

        {/* Partial Take Profit */}
        <div className="switch-group">
          <span className="switch-label" style={{ cursor: 'pointer' }} onClick={() => handleRiskParamChange('partialTakeProfitEnabled', !riskSettings.partialTakeProfitEnabled)}>
            Partial Scale-out (Target 1)
          </span>
          <label className="switch">
            <input type="checkbox" checked={riskSettings.partialTakeProfitEnabled} onChange={(e) => handleRiskParamChange('partialTakeProfitEnabled', e.target.checked)} />
            <span className="slider"></span>
          </label>
        </div>
        <div style={{ fontSize: '10px', color: 'var(--text-secondary)', paddingLeft: '12px', marginBottom: '12px' }}>
          Closes 50% of position at 1.5R, moving remaining SL to break-even to guarantee a risk-free trade.
        </div>

        {/* Trailing Stop Switch */}
        <div className="switch-group">
          <span className="switch-label" style={{ cursor: 'pointer' }} onClick={() => handleRiskParamChange('trailingStopEnabled', !riskSettings.trailingStopEnabled)}>
            Enable Trailing Stop Loss
          </span>
          <label className="switch">
            <input
              type="checkbox"
              checked={riskSettings.trailingStopEnabled}
              onChange={(e) => handleRiskParamChange('trailingStopEnabled', e.target.checked)} 
            />
            <span className="slider"></span>
          </label>
        </div>
        
        {riskSettings.trailingStopEnabled && (
          <div className="form-group" style={{ paddingLeft: '12px', borderLeft: '2px solid var(--border-color)', marginTop: '8px' }}>
            <label className="form-label">
              <span>Trailing Trigger Level:</span>
              <span className="val">{riskSettings.trailingStopTrigger} RRR</span>
            </label>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              className="range-input"
              value={riskSettings.trailingStopTrigger}
              onChange={(e) => handleRiskParamChange('trailingStopTrigger', parseFloat(e.target.value))}
            />
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
              Moves SL to entry + 20% risk offset when profit hits {riskSettings.trailingStopTrigger}x SL distance.
            </div>
          </div>
        )}
      </div>

      {/* 2. Trading Strategy Settings */}
      <div className="sidebar-section">
        <h3 className="section-heading">
          <Sliders size={16} className="gold-text" />
          Trading Strategy Settings
        </h3>

        {/* Strategy Selector */}
        <div className="form-group">
          <label className="form-label">Active Strategy:</label>
          <select
            className="select-input"
            value={stratSettings.strategyType}
            onChange={handleStrategyChange}
          >
            <option value="TREND_FOLLOWING">EMA Golden Cross + RSI</option>
            <option value="MEAN_REVERSION">Bollinger Bands + RSI</option>
            <option value="MOMENTUM_BREAKOUT">Momentum Breakout (ATR)</option>
            <option value="HIGH_FREQUENCY_SCALPER">High-Frequency Scalper (EMA Cross + RSI)</option>
          </select>
        </div>

        {/* Trading Pairs */}
        <div className="form-group">
          <label className="form-label">
            <span>Trading Pairs (comma separated):</span>
          </label>
          <input
            type="text"
            className="text-input"
            value={symbol}
            disabled={botActive}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="e.g. BTC/USDT, ETH/USDT, SOL/USDT"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
          {botActive ? (
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              🔒 Stop the bot to change trading pairs.
            </div>
          ) : (
            <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Enter multiple pairs separated by commas to run a multi-asset portfolio.
            </div>
          )}
        </div>

        {/* ADX Trend Filter Threshold */}
        <div className="form-group">
          <label className="form-label">
            <span>ADX Filter Threshold:</span>
            <span className="val">{stratSettings.adxThreshold || 25}</span>
          </label>
          <input
            type="range"
            min="10"
            max="40"
            step="1"
            className="range-input"
            value={stratSettings.adxThreshold || 25}
            onChange={(e) => handleStratParamChange('adxThreshold', parseInt(e.target.value))}
          />
          <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
            Filters entries based on trend strength (ADX &gt; limit for trends, ADX &lt; limit for range-bound).
          </div>
        </div>

        {/* Multi-Timeframe Trend Alignment Toggle */}
        <div className="switch-group">
          <span className="switch-label" style={{ cursor: 'pointer' }} onClick={() => handleStratParamChange('useMultiTimeframe', !stratSettings.useMultiTimeframe)}>
            Multi-Timeframe 4H Filter
          </span>
          <label className="switch">
            <input type="checkbox" checked={stratSettings.useMultiTimeframe} onChange={(e) => handleStratParamChange('useMultiTimeframe', e.target.checked)} />
            <span className="slider"></span>
          </label>
        </div>
        <div style={{ fontSize: '10px', color: 'var(--text-secondary)', paddingLeft: '12px', marginBottom: '12px' }}>
          Align 15m entry signals with 4H macro EMA trend (EMA20 vs EMA50).
        </div>

        {stratSettings.strategyType === 'TREND_FOLLOWING' && (
          <>
            <div className="form-group">
              <label className="form-label">
                <span>Short EMA Period:</span>
                <span className="val">{stratSettings.emaShortPeriod}</span>
              </label>
              <input
                type="range"
                min="5"
                max="30"
                className="range-input"
                value={stratSettings.emaShortPeriod}
                onChange={(e) => handleStratParamChange('emaShortPeriod', parseInt(e.target.value))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">
                <span>Long EMA Period:</span>
                <span className="val">{stratSettings.emaLongPeriod}</span>
              </label>
              <input
                type="range"
                min="30"
                max="100"
                className="range-input"
                value={stratSettings.emaLongPeriod}
                onChange={(e) => handleStratParamChange('emaLongPeriod', parseInt(e.target.value))}
              />
            </div>
          </>
        )}

        {stratSettings.strategyType === 'MEAN_REVERSION' && (
          <>
            <div className="form-group">
              <label className="form-label">
                <span>RSI Oversold Level:</span>
                <span className="val">{stratSettings.rsiOversold}</span>
              </label>
              <input
                type="range"
                min="15"
                max="40"
                className="range-input"
                value={stratSettings.rsiOversold}
                onChange={(e) => handleStratParamChange('rsiOversold', parseInt(e.target.value))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">
                <span>RSI Overbought Level:</span>
                <span className="val">{stratSettings.rsiOverbought}</span>
              </label>
              <input
                type="range"
                min="60"
                max="85"
                className="range-input"
                value={stratSettings.rsiOverbought}
                onChange={(e) => handleStratParamChange('rsiOverbought', parseInt(e.target.value))}
              />
            </div>
          </>
        )}

        {stratSettings.strategyType === 'MOMENTUM_BREAKOUT' && (
          <div className="form-group">
            <label className="form-label">
              <span>ATR Period:</span>
              <span className="val">{stratSettings.atrPeriod}</span>
            </label>
            <input
              type="range"
              min="10"
              max="30"
              className="range-input"
              value={stratSettings.atrPeriod}
              onChange={(e) => handleStratParamChange('atrPeriod', parseInt(e.target.value))}
            />
          </div>
        )}
      </div>

      {/* 3. Indicators Visible Toggles */}
      <div className="sidebar-section">
        <h3 className="section-heading">
          <Settings size={16} className="blue-text" />
          Chart Overlays
        </h3>

        <div className="switch-group">
          <span className="switch-label" style={{ cursor: 'pointer' }} onClick={() => toggleIndicator('ema20')}>Show EMA 20 (Gold)</span>
          <label className="switch">
            <input type="checkbox" checked={showIndicators.ema20} onChange={() => toggleIndicator('ema20')} />
            <span className="slider"></span>
          </label>
        </div>

        <div className="switch-group">
          <span className="switch-label" style={{ cursor: 'pointer' }} onClick={() => toggleIndicator('ema50')}>Show EMA 50 (Blue)</span>
          <label className="switch">
            <input type="checkbox" checked={showIndicators.ema50} onChange={() => toggleIndicator('ema50')} />
            <span className="slider"></span>
          </label>
        </div>

        <div className="switch-group">
          <span className="switch-label" style={{ cursor: 'pointer' }} onClick={() => toggleIndicator('ema200')}>Show EMA 200 (Purple)</span>
          <label className="switch">
            <input type="checkbox" checked={showIndicators.ema200} onChange={() => toggleIndicator('ema200')} />
            <span className="slider"></span>
          </label>
        </div>

        <div className="switch-group">
          <span className="switch-label" style={{ cursor: 'pointer' }} onClick={() => toggleIndicator('bb')}>Show Bollinger Bands</span>
          <label className="switch">
            <input type="checkbox" checked={showIndicators.bb} onChange={() => toggleIndicator('bb')} />
            <span className="slider"></span>
          </label>
        </div>
      </div>
    </div>
  );
};
