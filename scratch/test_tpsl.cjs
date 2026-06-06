const ccxt = require('ccxt');
require('dotenv').config();

async function main() {
  const exchange = new ccxt.bybit({
    apiKey: process.env.EXCHANGE_API_KEY,
    secret: process.env.EXCHANGE_API_SECRET,
    enableRateLimit: true,
    timeout: 10000,
    options: {
      defaultType: 'swap'
    }
  });

  try {
    console.log("Loading markets...");
    await exchange.loadMarkets();

    console.log("Fetching positions...");
    const positions = await exchange.fetchPositions();
    const openPositions = positions.filter(p => parseFloat(p.contracts || p.size || 0) > 0);
    console.log("Open Positions:", openPositions.length);

    if (openPositions.length === 0) {
      console.log("No open positions to test TP/SL attachment. Checking all positions templates...");
      for (const p of positions.slice(0, 5)) {
        console.log(`Symbol: ${p.symbol} | size: ${p.contracts || p.size} | positionIdx: ${p.positionIdx}`);
      }
      return;
    }

    const pos = openPositions[0];
    console.log("Testing on position:", pos.symbol, "side:", pos.side, "size:", pos.contracts, "positionIdx:", pos.positionIdx);

    // Calculate a mock TP/SL
    const entryPrice = parseFloat(pos.entryPrice);
    const sl = pos.side === 'long' ? entryPrice * 0.99 : entryPrice * 1.01;
    const tp = pos.side === 'long' ? entryPrice * 1.01 : entryPrice * 0.99;

    const marketSymbol = pos.symbol;
    const market = exchange.markets[marketSymbol];
    const rawSymbol = market ? market.id : marketSymbol.split(':')[0].replace('/', '');

    const params = {
      category: 'linear',
      symbol: rawSymbol,
      tpslMode: 'Full',
      positionIdx: pos.positionIdx,
      stopLoss: exchange.priceToPrecision(marketSymbol, sl),
      takeProfit: exchange.priceToPrecision(marketSymbol, tp),
    };

    console.log("Calling privatePostPositionTradingStop with params:", params);
    const response = await exchange.privatePostPositionTradingStop(params);
    console.log("Response:", JSON.stringify(response));

  } catch (err) {
    console.error("Error setting TP/SL:", err);
  }
}

main();
