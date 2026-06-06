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
    console.log(`Open Positions count: ${openPositions.length}`);
    
    for (const p of openPositions) {
      console.log(`Symbol: ${p.symbol}`);
      console.log(`Side: ${p.side}`);
      console.log(`Contracts/Size: ${p.contracts || p.size}`);
      console.log(`Entry Price: ${p.entryPrice}`);
      console.log(`Stop Loss (Parsed by CCXT): ${p.stopLoss}`);
      console.log(`Take Profit (Parsed by CCXT): ${p.takeProfit}`);
      console.log(`Trailing Stop (Parsed by CCXT): ${p.trailingStop}`);
      console.log(`Raw Info keys:`, Object.keys(p.info || {}));
      if (p.info) {
        console.log(`Raw Info values - stopLoss: ${p.info.stopLoss}, takeProfit: ${p.info.takeProfit}, trailingStop: ${p.info.trailingStop}`);
      }
      console.log('---');
    }
  } catch (err) {
    console.error("Error fetching positions:", err);
  }
}

main();
