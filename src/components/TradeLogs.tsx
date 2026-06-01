import React, { useRef, useEffect, useState } from 'react';
import type { Position, LogMessage } from '../types';
import { Terminal, Briefcase, History, X, Activity } from 'lucide-react';

interface TradeLogsProps {
  activePosition: Position | null;
  closedTrades: Position[];
  logs: LogMessage[];
  onClosePosition: (symbol?: string) => void;
  latestPrice: number;
  allPositions?: Position[];
  evaluationStates?: Record<string, any>;
  accountBalance?: number;
}

export const TradeLogs: React.FC<TradeLogsProps> = ({
  activePosition,
  closedTrades,
  logs,
  onClosePosition,
  latestPrice,
  allPositions = [],
  evaluationStates = {},
  accountBalance = 10000,
}) => {
  const [activeTab, setActiveTab] = useState<'positions' | 'logs' | 'history' | 'diagnostics'>('positions');
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
        <button
          className={`tab-btn ${activeTab === 'diagnostics' ? 'active' : ''}`}
          onClick={() => setActiveTab('diagnostics')}
        >
          <Activity size={12} style={{ marginRight: '5px', verticalAlign: 'middle' }} />
          BOT DIAGNOSTICS ({Object.keys(evaluationStates).length})
        </button>
      </div>

      <div style={{ flexGrow: 1, overflowY: 'auto', minHeight: 0 }}>
        {/* Positions Tab */}
        {activeTab === 'positions' && (
          <div style={{ padding: '16px', height: '100%', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            {allPositions.length > 0 ? (() => {
              // Grouping positions
              const groups: {
                primary?: Position;
                hedge?: Position;
                single?: Position;
                symbol: string;
              }[] = [];

              const processedIds = new Set<string>();

              allPositions.forEach(pos => {
                if (processedIds.has(pos.id)) return;

                if (pos.isHedgedPair) {
                  if (pos.hedgedRole === 'PRIMARY') {
                    const pairedHedge = allPositions.find(p => p.id === pos.pairedPositionId);
                    groups.push({
                      symbol: pos.symbol,
                      primary: pos,
                      hedge: pairedHedge
                    });
                    processedIds.add(pos.id);
                    if (pairedHedge) processedIds.add(pairedHedge.id);
                  } else {
                    const pairedPrimary = allPositions.find(p => p.id === pos.pairedPositionId);
                    if (!pairedPrimary) {
                      groups.push({
                        symbol: pos.symbol,
                        hedge: pos
                      });
                      processedIds.add(pos.id);
                    }
                  }
                } else {
                  groups.push({
                    symbol: pos.symbol,
                    single: pos
                  });
                  processedIds.add(pos.id);
                }
              });

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {groups.map((group, idx) => {
                    let primaryPnlVal = 0;
                    let primaryPct = 0;
                    let hedgePnlVal = 0;
                    let hedgePct = 0;
                    let singlePnlVal = 0;
                    let singlePct = 0;

                    let groupUnrealizedPnl = 0;
                    let groupRealizedPnl = 0;

                    if (group.single) {
                      const curPrice = group.single.symbol === activePosition?.symbol ? latestPrice : group.single.entryPrice;
                      const diff = group.single.type === 'LONG' ? curPrice - group.single.entryPrice : group.single.entryPrice - curPrice;
                      singlePnlVal = diff * group.single.size * group.single.leverage;
                      singlePct = (singlePnlVal / (group.single.entryPrice * group.single.size)) * 100;
                      groupUnrealizedPnl += singlePnlVal;
                    }

                    if (group.primary) {
                      const curPrice = group.primary.symbol === activePosition?.symbol ? latestPrice : group.primary.entryPrice;
                      const diff = group.primary.type === 'LONG' ? curPrice - group.primary.entryPrice : group.primary.entryPrice - curPrice;
                      primaryPnlVal = diff * group.primary.size * group.primary.leverage;
                      primaryPct = (primaryPnlVal / (group.primary.entryPrice * group.primary.size)) * 100;
                      groupUnrealizedPnl += primaryPnlVal;
                    } else if (group.hedge) {
                      const cp = closedTrades.find(t => t.id === group.hedge?.pairedPositionId);
                      if (cp) {
                        primaryPnlVal = cp.pnl;
                        primaryPct = cp.pnlPercent;
                        groupRealizedPnl += cp.pnl;
                      }
                    }

                    if (group.hedge) {
                      const curPrice = group.hedge.symbol === activePosition?.symbol ? latestPrice : group.hedge.entryPrice;
                      const diff = group.hedge.type === 'LONG' ? curPrice - group.hedge.entryPrice : group.hedge.entryPrice - curPrice;
                      hedgePnlVal = diff * group.hedge.size * group.hedge.leverage;
                      hedgePct = (hedgePnlVal / (group.hedge.entryPrice * group.hedge.size)) * 100;
                      groupUnrealizedPnl += hedgePnlVal;
                    } else if (group.primary) {
                      const ch = closedTrades.find(t => t.id === group.primary?.pairedPositionId);
                      if (ch) {
                        hedgePnlVal = ch.pnl;
                        hedgePct = ch.pnlPercent;
                        groupRealizedPnl += ch.pnl;
                      }
                    }

                    const combinedPnl = groupRealizedPnl + groupUnrealizedPnl;

                    let hedgeEfficiency = null;
                    if (primaryPnlVal < 0) {
                      hedgeEfficiency = (hedgePnlVal / Math.abs(primaryPnlVal)) * 100;
                    }

                    let riskExposure = 0;
                    if (group.single) {
                      riskExposure = ((group.single.size * group.single.entryPrice) / accountBalance) * 100;
                    }
                    if (group.primary) {
                      riskExposure += ((group.primary.size * group.primary.entryPrice) / accountBalance) * 100;
                    }
                    if (group.hedge) {
                      riskExposure += ((group.hedge.size * group.hedge.entryPrice) / accountBalance) * 100;
                    }

                    const activeScenario = group.primary?.hedgedScenario || group.hedge?.hedgedScenario || 'NONE';
                    const isHedged = !!(group.primary || group.hedge);

                    return (
                      <div
                        key={idx}
                        style={{
                          background: 'var(--bg-tertiary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: 'var(--radius-lg)',
                          padding: '16px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '12px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '15px', fontWeight: 'bold', fontFamily: 'var(--font-mono)' }}>{group.symbol}</span>
                            {isHedged && (
                              <span className="badge" style={{ background: 'rgba(37, 99, 235, 0.1)', color: 'var(--accent-blue)', fontSize: '9px' }}>
                                HEDGED PAIR
                              </span>
                            )}
                            {isHedged && activeScenario !== 'NONE' && (
                              <span className="badge" style={{ background: 'rgba(245, 158, 11, 0.15)', color: 'var(--accent-gold)', fontSize: '9px' }}>
                                SCENARIO {activeScenario}
                              </span>
                            )}
                          </div>

                          <button
                            onClick={() => onClosePosition(group.symbol)}
                            className="btn btn-secondary"
                            style={{ width: 'auto', padding: '4px 10px', fontSize: '11px', display: 'flex', gap: '4px', alignItems: 'center' }}
                          >
                            <X size={12} /> {isHedged ? 'Close Pair' : 'Close Trade'}
                          </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {group.single && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                              <div>
                                <span className={`badge ${group.single.type === 'LONG' ? 'badge-long' : 'badge-short'}`} style={{ fontSize: '9px', marginRight: '6px' }}>
                                  {group.single.type} {group.single.leverage}X
                                </span>
                                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                                  Entry: ${group.single.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })} | SL: ${group.single.stopLoss.toLocaleString()} | TP: ${group.single.takeProfit.toLocaleString()}
                                </span>
                              </div>
                              <span className={singlePnlVal >= 0 ? 'green-text' : 'red-text'} style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold', fontSize: '12px' }}>
                                {singlePnlVal >= 0 ? '+' : ''}${singlePnlVal.toFixed(2)} ({singlePnlVal >= 0 ? '+' : ''}{singlePct.toFixed(1)}%)
                              </span>
                            </div>
                          )}

                          {group.primary && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid var(--accent-blue)' }}>
                              <div>
                                <span className="badge" style={{ background: 'rgba(37, 99, 235, 0.15)', color: 'var(--accent-blue)', fontSize: '8px', padding: '1px 3px', marginRight: '6px' }}>PRIMARY</span>
                                <span className={`badge ${group.primary.type === 'LONG' ? 'badge-long' : 'badge-short'}`} style={{ fontSize: '9px', marginRight: '6px' }}>
                                  {group.primary.type} {group.primary.leverage}X
                                </span>
                                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                                  Entry: ${group.primary.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })} | SL: ${group.primary.stopLoss.toLocaleString()} | TP: ${group.primary.takeProfit.toLocaleString()}
                                </span>
                              </div>
                              <span className={primaryPnlVal >= 0 ? 'green-text' : 'red-text'} style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold', fontSize: '12px' }}>
                                {primaryPnlVal >= 0 ? '+' : ''}${primaryPnlVal.toFixed(2)} ({primaryPnlVal >= 0 ? '+' : ''}{primaryPct.toFixed(1)}%)
                              </span>
                            </div>
                          )}
                          {!group.primary && isHedged && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid var(--border-color)', opacity: 0.6 }}>
                              <div>
                                <span className="badge" style={{ background: 'var(--border-color)', color: 'var(--text-secondary)', fontSize: '8px', padding: '1px 3px', marginRight: '6px' }}>PRIMARY</span>
                                <span className="badge" style={{ background: 'var(--border-color)', color: 'var(--text-secondary)', fontSize: '9px', marginRight: '6px' }}>CLOSED</span>
                              </div>
                              <span className={primaryPnlVal >= 0 ? 'green-text' : 'red-text'} style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold', fontSize: '12px' }}>
                                Realized: {primaryPnlVal >= 0 ? '+' : ''}${primaryPnlVal.toFixed(2)}
                              </span>
                            </div>
                          )}

                          {group.hedge && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid var(--accent-gold)' }}>
                              <div>
                                <span className="badge" style={{ background: 'rgba(245, 158, 11, 0.15)', color: 'var(--accent-gold)', fontSize: '8px', padding: '1px 3px', marginRight: '6px' }}>HEDGE</span>
                                <span className={`badge ${group.hedge.type === 'LONG' ? 'badge-long' : 'badge-short'}`} style={{ fontSize: '9px', marginRight: '6px' }}>
                                  {group.hedge.type} {group.hedge.leverage}X
                                </span>
                                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                                  Entry: ${group.hedge.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })} | SL: ${group.hedge.stopLoss.toLocaleString()} | TP: ${group.hedge.takeProfit.toLocaleString()}
                                </span>
                              </div>
                              <span className={hedgePnlVal >= 0 ? 'green-text' : 'red-text'} style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold', fontSize: '12px' }}>
                                {hedgePnlVal >= 0 ? '+' : ''}${hedgePnlVal.toFixed(2)} ({hedgePnlVal >= 0 ? '+' : ''}{hedgePct.toFixed(1)}%)
                              </span>
                            </div>
                          )}
                          {!group.hedge && isHedged && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid var(--border-color)', opacity: 0.6 }}>
                              <div>
                                <span className="badge" style={{ background: 'var(--border-color)', color: 'var(--text-secondary)', fontSize: '8px', padding: '1px 3px', marginRight: '6px' }}>HEDGE</span>
                                <span className="badge" style={{ background: 'var(--border-color)', color: 'var(--text-secondary)', fontSize: '9px', marginRight: '6px' }}>CLOSED</span>
                              </div>
                              <span className={hedgePnlVal >= 0 ? 'green-text' : 'red-text'} style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold', fontSize: '12px' }}>
                                Realized: {hedgePnlVal >= 0 ? '+' : ''}${hedgePnlVal.toFixed(2)}
                              </span>
                            </div>
                          )}
                        </div>

                        <div
                          style={{
                            borderTop: '1px solid var(--border-color)',
                            paddingTop: '10px',
                            display: 'grid',
                            gridTemplateColumns: isHedged ? 'repeat(4, 1fr)' : 'repeat(2, 1fr)',
                            gap: '8px',
                            textAlign: 'center',
                            fontSize: '11px',
                          }}
                        >
                          <div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '9px', textTransform: 'uppercase' }}>Combined PnL</div>
                            <span className={combinedPnl >= 0 ? 'green-text' : 'red-text'} style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>
                              {combinedPnl >= 0 ? '+' : ''}${combinedPnl.toFixed(2)}
                            </span>
                          </div>

                          {isHedged && (
                            <>
                              <div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '9px', textTransform: 'uppercase' }}>Realized PnL</div>
                                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold', color: groupRealizedPnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                                  ${groupRealizedPnl.toFixed(2)}
                                </span>
                              </div>
                              <div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '9px', textTransform: 'uppercase' }}>Hedge Efficiency</div>
                                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                                  {hedgeEfficiency !== null ? `${hedgeEfficiency.toFixed(1)}%` : 'N/A'}
                                </span>
                              </div>
                            </>
                          )}

                          <div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '9px', textTransform: 'uppercase' }}>Risk Exposure</div>
                            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold', color: riskExposure > 100 ? 'var(--accent-red)' : 'var(--text-primary)' }}>
                              {riskExposure.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()
            : activePosition ? (
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

        {/* BOT DIAGNOSTICS Tab */}
        {activeTab === 'diagnostics' && (
          <div style={{ padding: '16px', height: '100%', overflowY: 'auto' }}>
            {Object.keys(evaluationStates).length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                No diagnostics data received.
                <div style={{ fontSize: '11px', marginTop: '6px', textAlign: 'center' }}>
                  Wait for the bot background loop to execute (ticking every 10 seconds).
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                {Object.keys(evaluationStates).map((symbol) => {
                  const evalState = evaluationStates[symbol];
                  if (!evalState) return null;

                  const rsi = parseFloat(evalState.rsi);
                  const adx = parseFloat(evalState.adx);
                  const isRsiOverbought = rsi >= 70;
                  const isRsiOversold = rsi <= 30;
                  const isAdxTrending = adx >= 25;

                  let badgeClass = 'badge-secondary';
                  let statusColor = 'var(--text-secondary)';
                  if (evalState.status === 'POSITION_OPEN' || evalState.status === 'EXECUTING') {
                    badgeClass = 'badge-long'; // green
                    statusColor = 'var(--accent-green)';
                  } else if (evalState.status === 'WAITING_FOR_SIGNAL') {
                    badgeClass = 'badge-blue';
                    statusColor = 'var(--accent-blue)';
                  } else if (evalState.status === 'REJECTED' || evalState.status === 'ERROR') {
                    badgeClass = 'badge-short'; // red
                    statusColor = 'var(--accent-red)';
                  } else if (evalState.status === 'COOLDOWN') {
                    badgeClass = 'badge-gold';
                    statusColor = 'var(--accent-gold)';
                  }

                  return (
                    <div
                      key={symbol}
                      style={{
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        padding: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
                        transition: 'all 0.2s',
                        cursor: 'default',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = statusColor; e.currentTarget.style.boxShadow = `0 0 10px ${statusColor}1A`; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.05)'; }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 'bold', fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{symbol}</span>
                        <span
                          className={`badge ${badgeClass}`}
                          style={{
                            fontSize: '9px',
                            padding: '2px 6px',
                            fontWeight: 'bold',
                            letterSpacing: '0.5px',
                            ...(evalState.status === 'WAITING_FOR_SIGNAL' ? { backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.2)' } : {}),
                            ...(evalState.status === 'COOLDOWN' ? { backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.2)' } : {}),
                          }}
                        >
                          {evalState.status}
                        </span>
                      </div>

                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                        <strong>Decision:</strong> {evalState.reason}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '10px', fontFamily: 'var(--font-mono)', borderTop: '1px solid var(--border-color)', paddingTop: '8px', marginTop: '4px' }}>
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>RSI: </span>
                          <span style={{
                            fontWeight: 'bold',
                            color: isRsiOverbought ? 'var(--accent-red)' : isRsiOversold ? 'var(--accent-green)' : 'var(--text-primary)'
                          }}>
                            {isNaN(rsi) ? 'N/A' : rsi.toFixed(1)}
                          </span>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>ADX: </span>
                          <span style={{
                            fontWeight: 'bold',
                            color: isAdxTrending ? 'var(--accent-green)' : 'var(--text-muted)'
                          }}>
                            {isNaN(adx) ? 'N/A' : adx.toFixed(1)}
                          </span>
                        </div>
                        <div style={{ gridColumn: 'span 2' }}>
                          <span style={{ color: 'var(--text-muted)' }}>EMA: </span>
                          <span style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>{evalState.emaState || 'N/A'}</span>
                        </div>
                        {evalState.minNotional !== undefined && (
                          <div style={{ gridColumn: 'span 2', color: 'var(--text-muted)' }}>
                            <span>Min Cost: </span>
                            <span style={{ color: 'var(--text-secondary)' }}>${evalState.minNotional.toFixed(2)} USDT</span>
                          </div>
                        )}
                      </div>

                      {/* News Sentiment metrics */}
                      {evalState.newsSentiment !== undefined && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '10px', borderTop: '1px solid var(--border-color)', paddingTop: '6px', marginTop: '4px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)' }}>
                            <span>
                              <span style={{ color: 'var(--text-muted)' }}>News: </span>
                              <span style={{
                                fontWeight: 'bold',
                                color: evalState.newsSentiment >= 1.5 ? 'var(--accent-green)' : evalState.newsSentiment <= -1.5 ? 'var(--accent-red)' : 'var(--text-primary)'
                              }}>
                                {evalState.newsSentiment > 0 ? '+' : ''}{evalState.newsSentiment.toFixed(2)}
                              </span>
                            </span>
                            <span>
                              <span style={{ color: 'var(--text-muted)' }}>Whales: </span>
                              <span style={{
                                fontWeight: 'bold',
                                color: evalState.whaleImbalance > 0 ? 'var(--accent-green)' : evalState.whaleImbalance < 0 ? 'var(--accent-red)' : 'var(--text-primary)'
                              }}>
                                {evalState.whaleImbalance > 0 ? '+' : ''}{evalState.whaleImbalance.toFixed(2)}
                              </span>
                            </span>
                          </div>
                          {evalState.latestStory && (
                            <div style={{ fontSize: '9px', color: 'var(--text-secondary)', fontStyle: 'italic', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '280px' }} title={evalState.latestStory}>
                              📰 {evalState.latestStory}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
