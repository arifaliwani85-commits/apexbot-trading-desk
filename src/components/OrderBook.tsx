import React, { useEffect, useState } from 'react';

interface OrderBookProps {
  latestPrice: number;
}

interface OrderBookRow {
  price: number;
  size: number;
  total: number;
  percentage: number;
}

export const OrderBook: React.FC<OrderBookProps> = ({ latestPrice }) => {
  const [asks, setAsks] = useState<OrderBookRow[]>([]);
  const [bids, setBids] = useState<OrderBookRow[]>([]);
  const [spread, setSpread] = useState(0);
  const [spreadPercent, setSpreadPercent] = useState(0);

  // Generate or fluctuate order book relative to current price
  useEffect(() => {
    if (latestPrice === 0) return;

    const rowCount = 6;
    const priceStep = parseFloat((latestPrice * 0.0003).toFixed(2)) || 0.1;
    
    // Spread fluctuation (0.01% to 0.05%)
    const currentSpread = parseFloat((latestPrice * (0.0001 + Math.random() * 0.0004)).toFixed(2));
    const halfSpread = currentSpread / 2;

    const newAsks: OrderBookRow[] = [];
    const newBids: OrderBookRow[] = [];
    
    let askTotal = 0;
    let bidTotal = 0;

    // Generate Asks (Sell Orders) - higher prices, sorted highest to lowest for rendering
    for (let i = rowCount; i >= 1; i--) {
      const p = parseFloat((latestPrice + halfSpread + i * priceStep).toFixed(2));
      const s = Math.random() * 2 + 0.1; // random size
      askTotal += s;
      newAsks.push({
        price: p,
        size: s,
        total: askTotal,
        percentage: 0, // calculated below
      });
    }

    // Generate Bids (Buy Orders) - lower prices, sorted highest to lowest
    for (let i = 1; i <= rowCount; i++) {
      const p = parseFloat((latestPrice - halfSpread - i * priceStep).toFixed(2));
      const s = Math.random() * 2 + 0.1;
      bidTotal += s;
      newBids.push({
        price: p,
        size: s,
        total: bidTotal,
        percentage: 0, // calculated below
      });
    }

    // Calculate percentages for depth bar fills
    const maxAskTotal = askTotal || 1;
    const maxBidTotal = bidTotal || 1;

    const asksProcessed = newAsks.map((a) => ({
      ...a,
      percentage: (a.total / maxAskTotal) * 100,
    }));

    const bidsProcessed = newBids.map((b) => ({
      ...b,
      percentage: (b.total / maxBidTotal) * 100,
    }));

    setAsks(asksProcessed);
    setBids(bidsProcessed);
    setSpread(currentSpread);
    setSpreadPercent((currentSpread / latestPrice) * 100);
  }, [latestPrice, Math.floor(Math.random() * 4)]); // small periodic trigger

  return (
    <div className="orderbook-container">
      <div className="panel-title" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-color)' }}>
        <span>ORDER BOOK</span>
        <span className="value-mono" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
          STEP: 0.01%
        </span>
      </div>

      <table className="orderbook-table" style={{ flexGrow: 1 }}>
        <thead>
          <tr>
            <th style={{ width: '40%' }}>Price (USDT)</th>
            <th style={{ width: '30%' }}>Size</th>
            <th style={{ width: '30%' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {/* Asks (Sells) */}
          {asks.map((ask, idx) => (
            <tr key={`ask_${idx}`} className="orderbook-row">
              <td className="red-text" style={{ paddingLeft: '12px' }}>
                <span className="orderbook-cell-val">{ask.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </td>
              <td>
                <span className="orderbook-cell-val" style={{ color: 'var(--text-primary)' }}>{ask.size.toFixed(3)}</span>
              </td>
              <td style={{ paddingRight: '12px', position: 'relative' }}>
                <div className="depth-bar-asks" style={{ width: `${ask.percentage}%` }}></div>
                <span className="orderbook-cell-val" style={{ color: 'var(--text-secondary)' }}>{ask.total.toFixed(3)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Spread Display */}
      <div className="spread-display">
        <span className={asks.length > 0 && bids.length > 0 ? (Math.random() > 0.5 ? 'green-text' : 'red-text') : ''}>
          ${latestPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>
        <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
          Spread: ${spread.toFixed(2)} ({spreadPercent.toFixed(3)}%)
        </span>
      </div>

      <table className="orderbook-table" style={{ flexGrow: 1 }}>
        <tbody>
          {/* Bids (Buys) */}
          {bids.map((bid, idx) => (
            <tr key={`bid_${idx}`} className="orderbook-row">
              <td className="green-text" style={{ paddingLeft: '12px' }}>
                <span className="orderbook-cell-val">{bid.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </td>
              <td>
                <span className="orderbook-cell-val" style={{ color: 'var(--text-primary)' }}>{bid.size.toFixed(3)}</span>
              </td>
              <td style={{ paddingRight: '12px', position: 'relative' }}>
                <div className="depth-bar-bids" style={{ width: `${bid.percentage}%` }}></div>
                <span className="orderbook-cell-val" style={{ color: 'var(--text-secondary)' }}>{bid.total.toFixed(3)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
