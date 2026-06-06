const ccxt = require('ccxt');
require('dotenv').config();

async function main() {
  console.log("Configured API Key:", process.env.EXCHANGE_API_KEY);
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
    console.log("Markets loaded.");

    console.log("Fetching balance...");
    const balance = await exchange.fetchBalance();
    console.log("Total USDT:", balance.total.USDT);

    console.log("Fetching positions for APT/USDT:USDT...");
    const positions = await exchange.fetchPositions(['APT/USDT:USDT']);
    console.log("Positions count:", positions.length);
    for (const p of positions) {
      console.log(`Symbol: ${p.symbol} | side: ${p.side} | size: ${p.contracts || p.size} | positionIdx: ${p.positionIdx} | rawIdx: ${p.info ? (p.info.positionIdx || p.info.position_idx) : 'N/A'}`);
    }
  } catch (err) {
    console.error("Error during execution:", err);
  }
}

main();
