import React, { useRef, useEffect, useState } from 'react';
import type { Candle, Position } from '../types';

interface TradingChartProps {
  candles: Candle[];
  activePosition: Position | null;
  closedTrades: Position[];
  showIndicators: {
    ema20: boolean;
    ema50: boolean;
    ema200: boolean;
    bb: boolean;
  };
  symbol?: string;
}

export const TradingChart: React.FC<TradingChartProps> = ({
  candles,
  activePosition,
  closedTrades,
  showIndicators,
  symbol = 'BTC/USDT',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const rsiCanvasRef = useRef<HTMLCanvasElement>(null);

  const [visibleCandlesCount, setVisibleCandlesCount] = useState(60);
  const [scrollOffset, setScrollOffset] = useState(0); // 0 means show latest candles

  // Adjust scroll offset when candles array grows to keep showing the latest
  useEffect(() => {
    setScrollOffset(0);
  }, [candles.length]);

  const handleZoomIn = () => {
    setVisibleCandlesCount((prev) => Math.max(20, prev - 10));
  };

  const handleZoomOut = () => {
    setVisibleCandlesCount((prev) => Math.min(120, prev + 10));
  };

  const handleScrollLeft = () => {
    setScrollOffset((prev) => Math.min(candles.length - visibleCandlesCount, prev + 5));
  };

  const handleScrollRight = () => {
    setScrollOffset((prev) => Math.max(0, prev - 5));
  };

  const handleScrollReset = () => {
    setScrollOffset(0);
  };

  // Draw chart function
  const drawChart = () => {
    const mainCanvas = mainCanvasRef.current;
    const rsiCanvas = rsiCanvasRef.current;
    if (!mainCanvas || !rsiCanvas || candles.length === 0) return;

    const mainCtx = mainCanvas.getContext('2d');
    const rsiCtx = rsiCanvas.getContext('2d');
    if (!mainCtx || !rsiCtx) return;

    // Set dimensions based on client bounding rect for high DPI displays
    const rect = containerRef.current?.getBoundingClientRect();
    const width = rect?.width || 800;
    
    // Allocate heights
    const mainHeight = 320;
    const rsiHeight = 90;

    mainCanvas.width = width;
    mainCanvas.height = mainHeight;
    rsiCanvas.width = width;
    rsiCanvas.height = rsiHeight;

    // Determine the visible slice of candles
    const endIndex = candles.length - scrollOffset;
    const startIndex = Math.max(0, endIndex - visibleCandlesCount);
    const visibleCandles = candles.slice(startIndex, endIndex);

    if (visibleCandles.length === 0) return;

    // 1. Calculate price range for scaling
    let minPrice = Infinity;
    let maxPrice = -Infinity;

    visibleCandles.forEach((c) => {
      // Basic price bounds
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;

      // Include indicators in bounds if they are visible
      if (showIndicators.ema20 && c.ema20) {
        minPrice = Math.min(minPrice, c.ema20);
        maxPrice = Math.max(maxPrice, c.ema20);
      }
      if (showIndicators.ema50 && c.ema50) {
        minPrice = Math.min(minPrice, c.ema50);
        maxPrice = Math.max(maxPrice, c.ema50);
      }
      if (showIndicators.ema200 && c.ema200) {
        minPrice = Math.min(minPrice, c.ema200);
        maxPrice = Math.max(maxPrice, c.ema200);
      }
      if (showIndicators.bb && c.bbUpper && c.bbLower) {
        minPrice = Math.min(minPrice, c.bbLower);
        maxPrice = Math.max(maxPrice, c.bbUpper);
      }
      if (c.vwap) {
        minPrice = Math.min(minPrice, c.vwap);
        maxPrice = Math.max(maxPrice, c.vwap);
      }
    });

    // Also include active position limits (SL/TP) in the range so they are visible
    if (activePosition) {
      minPrice = Math.min(minPrice, activePosition.stopLoss, activePosition.entryPrice);
      maxPrice = Math.max(maxPrice, activePosition.takeProfit, activePosition.entryPrice);
    }

    // Add padding to price range
    const pricePadding = (maxPrice - minPrice) * 0.08 || 5.0;
    maxPrice += pricePadding;
    minPrice -= pricePadding;

    // Clear backgrounds
    mainCtx.fillStyle = '#080b0e';
    mainCtx.fillRect(0, 0, width, mainHeight);
    rsiCtx.fillStyle = '#080b0e';
    rsiCtx.fillRect(0, 0, width, rsiHeight);

    // Padding parameters
    const rightPadding = 75; // for prices
    const topPadding = 15;
    const bottomPadding = 15;
    const chartWidth = width - rightPadding;
    const chartHeight = mainHeight - topPadding - bottomPadding;

    // Helper functions for coordinates
    const getX = (index: number) => {
      const step = chartWidth / visibleCandles.length;
      return index * step + step / 2;
    };

    const getY = (price: number) => {
      return (
        chartHeight -
        ((price - minPrice) / (maxPrice - minPrice)) * chartHeight +
        topPadding
      );
    };

    // --- DRAW GRID LINES & LABELS (MAIN CHART) ---
    mainCtx.strokeStyle = '#1b2028';
    mainCtx.lineWidth = 1;
    mainCtx.fillStyle = '#848e9c';
    mainCtx.font = '10px JetBrains Mono';
    mainCtx.textAlign = 'left';

    // Horizontal price grid
    const priceGridCount = 5;
    for (let i = 0; i <= priceGridCount; i++) {
      const priceVal = minPrice + (i / priceGridCount) * (maxPrice - minPrice);
      const y = getY(priceVal);
      
      mainCtx.beginPath();
      mainCtx.moveTo(0, y);
      mainCtx.lineTo(chartWidth, y);
      mainCtx.stroke();

      mainCtx.fillText(`$${priceVal.toFixed(2)}`, chartWidth + 6, y + 3);
    }

    // Vertical time grid (every 10 candles or so)
    const timeGridStep = Math.max(5, Math.floor(visibleCandles.length / 5));
    mainCtx.textAlign = 'center';
    visibleCandles.forEach((c, idx) => {
      if (idx % timeGridStep === 0) {
        const x = getX(idx);
        mainCtx.beginPath();
        mainCtx.moveTo(x, 0);
        mainCtx.lineTo(x, mainHeight);
        mainCtx.stroke();

        const date = new Date(c.time);
        const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        mainCtx.fillText(timeStr, x, mainHeight - 3);
      }
    });

    // --- DRAW BOLLINGER BANDS AREA (SHADING) ---
    if (showIndicators.bb) {
      mainCtx.beginPath();
      // Move to first lower BB coordinate
      let firstValidIdx = -1;
      visibleCandles.forEach((c, idx) => {
        if (c.bbLower && c.bbUpper && firstValidIdx === -1) {
          firstValidIdx = idx;
          mainCtx.moveTo(getX(idx), getY(c.bbLower));
        } else if (c.bbLower && c.bbUpper) {
          mainCtx.lineTo(getX(idx), getY(c.bbLower));
        }
      });
      // Move backwards on upper BB to close path
      for (let idx = visibleCandles.length - 1; idx >= firstValidIdx; idx--) {
        const c = visibleCandles[idx];
        if (c.bbUpper) {
          mainCtx.lineTo(getX(idx), getY(c.bbUpper));
        }
      }
      mainCtx.closePath();
      mainCtx.fillStyle = 'rgba(45, 140, 240, 0.03)';
      mainCtx.fill();

      // Draw lines
      mainCtx.lineWidth = 1.2;
      mainCtx.strokeStyle = 'rgba(45, 140, 240, 0.3)';
      
      // Upper Band
      mainCtx.beginPath();
      visibleCandles.forEach((c, idx) => {
        if (c.bbUpper) {
          if (idx === firstValidIdx) mainCtx.moveTo(getX(idx), getY(c.bbUpper));
          else mainCtx.lineTo(getX(idx), getY(c.bbUpper));
        }
      });
      mainCtx.stroke();

      // Lower Band
      mainCtx.beginPath();
      visibleCandles.forEach((c, idx) => {
        if (c.bbLower) {
          if (idx === firstValidIdx) mainCtx.moveTo(getX(idx), getY(c.bbLower));
          else mainCtx.lineTo(getX(idx), getY(c.bbLower));
        }
      });
      mainCtx.stroke();
    }

    // --- DRAW EMAS ---
    const drawEMALine = (key: 'ema20' | 'ema50' | 'ema200', color: string) => {
      mainCtx.beginPath();
      let first = true;
      visibleCandles.forEach((c, idx) => {
        const emaVal = c[key];
        if (emaVal && !isNaN(emaVal)) {
          const x = getX(idx);
          const y = getY(emaVal);
          if (first) {
            mainCtx.moveTo(x, y);
            first = false;
          } else {
            mainCtx.lineTo(x, y);
          }
        }
      });
      mainCtx.strokeStyle = color;
      mainCtx.lineWidth = 1.5;
      mainCtx.stroke();
    };

    if (showIndicators.ema20) drawEMALine('ema20', '#f0b90b'); // gold
    if (showIndicators.ema50) drawEMALine('ema50', '#2d8cf0'); // blue
    if (showIndicators.ema200) drawEMALine('ema200', '#9c52f5'); // purple

    // --- DRAW VWAP LINE ---
    const drawVWAPLine = () => {
      mainCtx.beginPath();
      let first = true;
      visibleCandles.forEach((c, idx) => {
        const vwapVal = c.vwap;
        if (vwapVal && !isNaN(vwapVal)) {
          const x = getX(idx);
          const y = getY(vwapVal);
          if (first) {
            mainCtx.moveTo(x, y);
            first = false;
          } else {
            mainCtx.lineTo(x, y);
          }
        }
      });
      mainCtx.strokeStyle = '#00e5ff'; // cyan
      mainCtx.lineWidth = 1.5;
      mainCtx.setLineDash([3, 3]);
      mainCtx.stroke();
      mainCtx.setLineDash([]);
    };
    drawVWAPLine();

    // --- DRAW CANDLESTICKS ---
    const candleWidth = (chartWidth / visibleCandles.length) * 0.7;

    visibleCandles.forEach((c, idx) => {
      const x = getX(idx);
      const yOpen = getY(c.open);
      const yClose = getY(c.close);
      const yHigh = getY(c.high);
      const yLow = getY(c.low);

      const isBullish = c.close >= c.open;
      const color = isBullish ? '#02c076' : '#f6465d';

      // Draw wick
      mainCtx.strokeStyle = color;
      mainCtx.lineWidth = 1.5;
      mainCtx.beginPath();
      mainCtx.moveTo(x, yHigh);
      mainCtx.lineTo(x, yLow);
      mainCtx.stroke();

      // Draw body
      mainCtx.fillStyle = color;
      const bodyHeight = Math.max(1, Math.abs(yClose - yOpen));
      mainCtx.fillRect(x - candleWidth / 2, Math.min(yOpen, yClose), candleWidth, bodyHeight);
    });

    // --- DRAW HISTORICAL TRADE SIGNAL MARKERS ---
    closedTrades.forEach((trade) => {
      // Find if this trade occurred within our visible window
      const entryIdx = candles.findIndex((c) => c.time === trade.entryTime);
      const exitIdx = candles.findIndex((c) => c.time === trade.exitTime);

      if (entryIdx >= startIndex && entryIdx < endIndex) {
        const idxInVisible = entryIdx - startIndex;
        const x = getX(idxInVisible);
        const candle = visibleCandles[idxInVisible];
        
        mainCtx.font = 'bold 9px Inter';
        mainCtx.textAlign = 'center';

        if (trade.type === 'LONG') {
          // Green arrow pointing UP
          mainCtx.fillStyle = '#02c076';
          mainCtx.beginPath();
          mainCtx.moveTo(x, getY(candle.low) + 12);
          mainCtx.lineTo(x - 5, getY(candle.low) + 20);
          mainCtx.lineTo(x + 5, getY(candle.low) + 20);
          mainCtx.closePath();
          mainCtx.fill();
          mainCtx.fillText('B', x, getY(candle.low) + 30);
        } else {
          // Red arrow pointing DOWN
          mainCtx.fillStyle = '#f6465d';
          mainCtx.beginPath();
          mainCtx.moveTo(x, getY(candle.high) - 12);
          mainCtx.lineTo(x - 5, getY(candle.high) - 20);
          mainCtx.lineTo(x + 5, getY(candle.high) - 20);
          mainCtx.closePath();
          mainCtx.fill();
          mainCtx.fillText('S', x, getY(candle.high) - 28);
        }
      }

      if (exitIdx >= startIndex && exitIdx < endIndex) {
        const idxInVisible = exitIdx - startIndex;
        const x = getX(idxInVisible);
        const candle = visibleCandles[idxInVisible];
        
        mainCtx.font = 'bold 9px Inter';
        mainCtx.fillStyle = '#848e9c';
        mainCtx.textAlign = 'center';
        
        // Draw Exit marker (gray dot with letter 'X')
        mainCtx.beginPath();
        const yPos = trade.type === 'LONG' ? getY(candle.high) - 15 : getY(candle.low) + 15;
        mainCtx.arc(x, yPos, 8, 0, Math.PI * 2);
        mainCtx.fillStyle = '#242c36';
        mainCtx.fill();
        mainCtx.strokeStyle = '#848e9c';
        mainCtx.stroke();
        mainCtx.fillStyle = '#eaecef';
        mainCtx.fillText('X', x, yPos + 3);
      }
    });

    // --- DRAW ACTIVE POSITION LINES (ENTRY, SL, TP) ---
    if (activePosition) {
      const pos = activePosition;
      
      const drawOrderLine = (price: number, label: string, color: string, style: 'dashed' | 'solid') => {
        const y = getY(price);
        mainCtx.strokeStyle = color;
        mainCtx.lineWidth = 1.2;
        if (style === 'dashed') {
          mainCtx.setLineDash([4, 4]);
        } else {
          mainCtx.setLineDash([]);
        }

        mainCtx.beginPath();
        mainCtx.moveTo(0, y);
        mainCtx.lineTo(chartWidth, y);
        mainCtx.stroke();
        mainCtx.setLineDash([]); // reset

        // Label flag on the right margin
        mainCtx.fillStyle = color;
        mainCtx.fillRect(chartWidth + 2, y - 8, rightPadding - 4, 16);
        
        mainCtx.fillStyle = '#fff';
        mainCtx.font = 'bold 9px JetBrains Mono';
        mainCtx.textAlign = 'left';
        mainCtx.fillText(label, chartWidth + 6, y + 3);
      };

      drawOrderLine(pos.entryPrice, 'ENT', '#f0b90b', 'dashed');
      drawOrderLine(pos.stopLoss, `SL`, '#f6465d', 'dashed');
      drawOrderLine(pos.takeProfit, `TP`, '#02c076', 'dashed');
    }

    // --- DRAW RSI OSCILLATOR (BOTTOM CHART) ---
    const rsiChartHeight = rsiHeight - 20;
    const getRsiY = (rsiVal: number) => {
      // 0 to 100 range
      return rsiChartHeight - (rsiVal / 100) * rsiChartHeight + 10;
    };

    // Draw horizontal bands
    rsiCtx.strokeStyle = '#1b2028';
    rsiCtx.lineWidth = 1;
    rsiCtx.beginPath();
    rsiCtx.moveTo(0, getRsiY(70)); rsiCtx.lineTo(chartWidth, getRsiY(70));
    rsiCtx.moveTo(0, getRsiY(30)); rsiCtx.lineTo(chartWidth, getRsiY(30));
    rsiCtx.stroke();

    // Shade region between 30 and 70
    rsiCtx.fillStyle = 'rgba(156, 82, 245, 0.02)';
    rsiCtx.fillRect(0, getRsiY(70), chartWidth, getRsiY(30) - getRsiY(70));

    // Draw labels
    rsiCtx.fillStyle = '#5e6673';
    rsiCtx.font = '9px JetBrains Mono';
    rsiCtx.textAlign = 'left';
    rsiCtx.fillText('70', chartWidth + 6, getRsiY(70) + 3);
    rsiCtx.fillText('30', chartWidth + 6, getRsiY(30) + 3);
    rsiCtx.fillStyle = '#848e9c';
    rsiCtx.fillText('RSI (14)', 10, 15);

    // Draw RSI curve
    rsiCtx.beginPath();
    let firstRsi = true;
    visibleCandles.forEach((c, idx) => {
      if (c.rsi !== undefined && !isNaN(c.rsi)) {
        const x = getX(idx);
        const y = getRsiY(c.rsi);
        if (firstRsi) {
          rsiCtx.moveTo(x, y);
          firstRsi = false;
        } else {
          rsiCtx.lineTo(x, y);
        }
      }
    });
    rsiCtx.strokeStyle = '#9c52f5'; // purple
    rsiCtx.lineWidth = 1.5;
    rsiCtx.stroke();

    // Draw oversold/overbought colored dots
    visibleCandles.forEach((c, idx) => {
      if (c.rsi !== undefined && !isNaN(c.rsi)) {
        if (c.rsi >= 70 || c.rsi <= 30) {
          const x = getX(idx);
          const y = getRsiY(c.rsi);
          rsiCtx.beginPath();
          rsiCtx.arc(x, y, 2.5, 0, Math.PI * 2);
          rsiCtx.fillStyle = c.rsi >= 70 ? '#f6465d' : '#02c076';
          rsiCtx.fill();
        }
      }
    });
  };

  // Re-draw chart on window resize or data changes
  useEffect(() => {
    drawChart();

    const resizeObserver = new ResizeObserver(() => {
      drawChart();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [candles, activePosition, showIndicators, visibleCandlesCount, scrollOffset]);

  const latestPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;
  const isUp = candles.length > 1 ? candles[candles.length - 1].close >= candles[candles.length - 2].close : true;

  return (
    <div ref={containerRef} className="chart-area" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="chart-controls">
        <button className="chart-control-btn" onClick={handleZoomIn} title="Zoom In">Zoom +</button>
        <button className="chart-control-btn" onClick={handleZoomOut} title="Zoom Out">Zoom -</button>
        <button 
          className="chart-control-btn" 
          onClick={handleScrollLeft} 
          disabled={scrollOffset >= candles.length - visibleCandlesCount}
          title="Scroll Left"
        >
          ← Scroll
        </button>
        <button 
          className="chart-control-btn" 
          onClick={handleScrollRight} 
          disabled={scrollOffset === 0}
          title="Scroll Right"
        >
          Scroll →
        </button>
        {scrollOffset > 0 && (
          <button className="chart-control-btn active" onClick={handleScrollReset} title="Jump to Latest">
            Live
          </button>
        )}
      </div>

      <div style={{ position: 'absolute', top: '15px', right: '15px', zIndex: 5, pointerEvents: 'none', textAlign: 'right' }}>
        <div style={{ fontSize: '20px', fontWeight: 'bold', fontFamily: 'var(--font-mono)', color: isUp ? 'var(--accent-green)' : 'var(--accent-red)' }}>
          ${latestPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
          {symbol || 'BTC/USDT'} (15M Chart)
        </div>
      </div>

      {/* Main Candlestick Chart */}
      <canvas ref={mainCanvasRef} style={{ display: 'block', flexGrow: 1 }} />
      
      {/* RSI Panel */}
      <div style={{ borderTop: '1px solid var(--border-color)', height: '90px', position: 'relative' }}>
        <canvas ref={rsiCanvasRef} style={{ display: 'block' }} />
      </div>
    </div>
  );
};
