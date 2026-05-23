import React, { useState } from 'react';
import type { BacktestResults, RiskSettings } from '../types';
import { Play, TrendingUp } from 'lucide-react';

interface BacktestPanelProps {
  onRunBacktest: (regime: 'BULL_TREND' | 'BEAR_TREND' | 'RANGING' | 'VOLATILE') => void;
  results: BacktestResults | null;
  riskSettings: RiskSettings;
}

export const BacktestPanel: React.FC<BacktestPanelProps> = ({
  onRunBacktest,
  results,
  riskSettings,
}) => {
  const [selectedRegime, setSelectedRegime] = useState<'BULL_TREND' | 'BEAR_TREND' | 'RANGING' | 'VOLATILE'>('BULL_TREND');

  return (
    <div className="bottom-panel-section" style={{ height: '100%', overflowY: 'auto' }}>
      <div className="panel-title">
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <TrendingUp size={14} className="blue-text" />
          HISTORICAL BACKTESTER
        </span>
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'none' }}>
          Test strategy rules over 500 candles
        </span>
      </div>

      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Configuration Row */}
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '150px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Market Regime:</span>
            <select
              className="select-input"
              value={selectedRegime}
              onChange={(e) => setSelectedRegime(e.target.value as any)}
            >
              <option value="BULL_TREND">📈 Strong Bull Trend</option>
              <option value="BEAR_TREND">📉 Strong Bear Trend</option>
              <option value="RANGING">↔️ Sideways / Ranging</option>
              <option value="VOLATILE">⚡ Volatile Whipsaws & Flash Crash</option>
            </select>
          </div>

          <button
            className="btn btn-primary"
            style={{ width: 'auto', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '8px' }}
            onClick={() => onRunBacktest(selectedRegime)}
          >
            <Play size={14} /> Run Historical Backtest
          </button>
        </div>

        {/* Backtest Results Statistics */}
        {results ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Summary statistics row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
              <div
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px' }}>NET PROFIT</div>
                <div
                  className={results.netProfitUsd >= 0 ? 'green-text' : 'red-text'}
                  style={{ fontSize: '16px', fontWeight: 'bold', fontFamily: 'var(--font-mono)' }}
                >
                  {results.netProfitUsd >= 0 ? '+' : ''}
                  {results.netProfitPercent.toFixed(2)}%
                  <div style={{ fontSize: '10px', fontWeight: 'normal', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    ${results.netProfitUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                </div>
              </div>

              <div
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px' }}>WIN RATE</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold', fontFamily: 'var(--font-mono)' }}>
                  {results.winRate.toFixed(1)}%
                  <div style={{ fontSize: '10px', fontWeight: 'normal', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {results.wins}W - {results.losses}L / {results.totalTrades} trades
                  </div>
                </div>
              </div>

              <div
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px' }}>MAX DRAWDOWN</div>
                <div className="red-text" style={{ fontSize: '16px', fontWeight: 'bold', fontFamily: 'var(--font-mono)' }}>
                  -{results.maxDrawdownPercent.toFixed(2)}%
                  <div style={{ fontSize: '10px', fontWeight: 'normal', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Max Peak-to-Valley loss
                  </div>
                </div>
              </div>

              <div
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px' }}>PROFIT FACTOR</div>
                <div
                  className={results.profitFactor >= 1.5 ? 'green-text' : results.profitFactor >= 1.0 ? 'gold-text' : 'red-text'}
                  style={{ fontSize: '16px', fontWeight: 'bold', fontFamily: 'var(--font-mono)' }}
                >
                  {results.profitFactor.toFixed(2)}
                  <div style={{ fontSize: '10px', fontWeight: 'normal', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Gross Profit / Loss
                  </div>
                </div>
              </div>
            </div>

            {/* Quality metric (Sharpe Ratio) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px', alignItems: 'center' }}>
              <div
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px' }}>SHARPE RATIO</div>
                <div
                  className={results.sharpeRatio >= 2.0 ? 'green-text' : results.sharpeRatio >= 1.0 ? 'gold-text' : 'red-text'}
                  style={{ fontSize: '15px', fontWeight: 'bold', fontFamily: 'var(--font-mono)' }}
                >
                  {results.sharpeRatio.toFixed(2)}
                </div>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                💡 <strong>Expectancy Breakdown:</strong> Having a positive expectancy means even with a 45% win rate, enforcing a 1:{riskSettings.riskRewardRatio} RRR makes this strategy mathematically profitable in the long term, while restricting single-trade losses to {riskSettings.riskPercent}% protects from capital ruin.
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: '24px',
              border: '1px dashed var(--border-color)',
              borderRadius: 'var(--radius-md)',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '13px',
            }}
          >
            No backtest run yet. Select a market condition above and click "Run" to test your parameters.
          </div>
        )}
      </div>
    </div>
  );
};
