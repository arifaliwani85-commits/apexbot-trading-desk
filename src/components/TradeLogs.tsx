import React, { useRef, useEffect, useState } from 'react';
import type { Position, LogMessage } from '../types';
import { Terminal, Briefcase, History, X } from 'lucide-react';

interface TradeLogsProps {
  activePosition: Position | null;
  closedTrades: Position[];
  logs: LogMessage[];
  onClosePosition: (symbol?: string) => void;
  latestPrice: number;
  allPositions?: Position[];
}

export const TradeLogs: React.FC<TradeLogsProps> = ({
  activePosition,
  closedTrades,
  logs,
  onClosePosition,
  latestPrice,
  allPositions = [],
}) => {
  const [activeTab, setActiveTab] = useState<'positions' | 'logs' | 'history'>('positions');
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (activeTab === 'logs' && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab]);

  // Calculate current PnL for active position
  const getLivePnl = () => {
    if (!activePosition) return { usd: 0, percent: 0 };
    const pos = activePosition;
    const diff = pos.type === 'LONG'
      ? latestPrice - pos.entryPrice
      : pos.entryPrice - latestPrice;
    
    const usd = diff * pos.size * pos.leverage;
    const percent = (usd / (pos.entryPrice * pos.size)) * 100;
    return { usd, percent };
  };

  const livePnl = getLivePnl();

  return (
    <div className="logs-container" style={{ display: 'flex', flexDirection: 'column', height: '50%' }}>
      {/* Tab Switcher */}
      <div className="tabs-header">
        <button
          className={`tab-btn ${activeTab === 'positions' ? 'active' : ''}`}
          onClick={() => setActiveTab('positions')}
        >
          <Briefcase size={12} style={{ marginRight: '5px', verticalAlign: 'middle' }} />
          POSITIONS ({allPositions.length > 0 ? allPositions.length : activePosition ? 1 : 0})
        </button>
        <button
          className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          <Terminal size={12} style={{ marginRight: '5px', verticalAlign: 'middle' }} />
          SYSTEM LOGS
        </button>
        <button
          className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <History size={12} style={{ marginRight: '5px', verticalAlign: 'middle' }} />
          HISTORY ({closedTrades.length})
        </button>
      </div>

      <div style={{ flexGrow: 1, overflowY: 'auto', minHeight: 0 }}>
        {/* Positions Tab */}
        {activeTab === 'positions' && (
          <div style={{ padding: '16px', height: '100%', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            {allPositions.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {allPositions.map((pos) => {
                  // Determine price to use for live pnl
                  const currentPriceForPnl = pos.symbol === activePosition?.symbol ? latestPrice : pos.entryPrice;
                  const diff = pos.type === 'LONG'
                    ? currentPriceForPnl - pos.entryPrice
                    : pos.entryPrice - currentPriceForPnl;
                  const pnlUsd = diff * pos.size * pos.leverage;
                  const pnlPct = (pnlUsd / (pos.entryPrice * pos.size)) * 100;
                  
                  return (
                    <div
                      key={pos.id}
                      style={{
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        padding: '12px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 'bold', fontFamily: 'var(--font-mono)' }}>{pos.symbol}</span>
                          <span className={`badge ${pos.type === 'LONG' ? 'badge-long' : 'badge-short'}`} style={{ fontSize: '9px', padding: '1px 4px' }}>
                            {pos.type} {pos.leverage}X
                          </span>
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>
                          Entry: ${pos.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })} | SL: ${pos.stopLoss.toLocaleString(undefined, { minimumFractionDigits: 2 })} | TP: ${pos.takeProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </div>
                      </div>
                      
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span className={pnlUsd >= 0 ? 'green-text' : 'red-text'} style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold', fontSize: '13px' }}>
                          {pnlUsd >= 0 ? '+' : ''}${pnlUsd.toFixed(2)} ({pnlUsd >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
                        </span>
                        <button
                          onClick={() => onClosePosition(pos.symbol)}
                          className="btn btn-secondary"
                          style={{ width: 'auto', padding: '2px 6px', fontSize: '10px', display: 'flex', gap: '2px', alignItems: 'center' }}
                        >
                          <X size={10} /> Close
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : activePosition ? (
              <div
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '16px',
                  position: 'relative',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span className={`badge ${activePosition.type === 'LONG' ? 'badge-long' : 'badge-short'}`}>
                    {activePosition.type} {activePosition.leverage}X
                  </span>
                  <button
                    onClick={() => onClosePosition()}
                    className="btn btn-secondary"
                    style={{ width: 'auto', padding: '4px 8px', fontSize: '11px', display: 'flex', gap: '4px', alignItems: 'center' }}
                    title="Market Close Position"
                  >
                    <X size={12} /> Close
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
                  <div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>ENTRY PRICE</div>
                    <div>${activePosition.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>CURRENT PRICE</div>
                    <div>${latestPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>STOP LOSS (SL)</div>
                    <div className="red-text">${activePosition.stopLoss.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>TAKE PROFIT (TP)</div>
                    <div className="green-text">${activePosition.takeProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>POSITION SIZE</div>
                    <div>{activePosition.size.toFixed(4)} MOCK</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>TOTAL VALUE</div>
                    <div>${(activePosition.size * activePosition.entryPrice).toFixed(2)}</div>
                  </div>
                </div>

                {/* Real-time PnL block */}
                <div
                  style={{
                    marginTop: '16px',
                    paddingTop: '12px',
                    borderTop: '1px solid var(--border-color)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontSize: '13px', fontWeight: '600' }}>Unrealized PnL</span>
                  <span
                    className={livePnl.usd >= 0 ? 'green-text' : 'red-text'}
                    style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold', fontSize: '16px' }}
                  >
                    {livePnl.usd >= 0 ? '+' : ''}
                    ${livePnl.usd.toFixed(2)} ({livePnl.usd >= 0 ? '+' : ''}
                    {livePnl.percent.toFixed(2)}%)
                  </span>
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: 'var(--text-muted)',
                  fontSize: '13px',
                }}
              >
                No active positions.
                <div style={{ fontSize: '11px', marginTop: '6px', textAlign: 'center', maxWidth: '80%' }}>
                  Enable the bot simulation to automatically execute setups when indicators align.
                </div>
              </div>
            )}
          </div>
        )}

        {/* System Logs Tab */}
        {activeTab === 'logs' && (
          <div className="log-list">
            {logs.map((log) => {
              const d = new Date(log.timestamp);
              const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
              return (
                <div key={log.id} className={`log-item ${log.type}`}>
                  <span className="log-time">[{timeStr}]</span>
                  <span>{log.text}</span>
                </div>
              );
            })}
            <div ref={logEndRef} />
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div style={{ height: '100%', overflowY: 'auto' }}>
            {closedTrades.length > 0 ? (
              <table className="trade-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th>Result (PnL)</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {[...closedTrades].reverse().map((trade) => (
                    <tr key={trade.id}>
                      <td>
                        <span className={`badge ${trade.type === 'LONG' ? 'badge-long' : 'badge-short'}`}>
                          {trade.type}
                        </span>
                      </td>
                      <td>${trade.entryPrice.toFixed(2)}</td>
                      <td>${trade.exitPrice?.toFixed(2)}</td>
                      <td className={trade.pnl >= 0 ? 'green-text' : 'red-text'}>
                        {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)} ({trade.pnlPercent.toFixed(2)}%)
                      </td>
                      <td style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                        <span className={`badge`} style={{ 
                          backgroundColor: trade.exitReason === 'TP' ? 'var(--accent-green-bg)' : trade.exitReason === 'SL' ? 'var(--accent-red-bg)' : 'var(--bg-tertiary)',
                          color: trade.exitReason === 'TP' ? 'var(--accent-green)' : trade.exitReason === 'SL' ? 'var(--accent-red)' : 'var(--text-secondary)'
                        }}>
                          {trade.exitReason}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: 'var(--text-muted)',
                  fontSize: '13px',
                }}
              >
                No trade history yet.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
