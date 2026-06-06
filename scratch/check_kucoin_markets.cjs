const ccxt = require('ccxt');

async function check() {
  const exchange = new ccxt.kucoinfutures();
  await exchange.loadMarkets();
  console.log('Total markets loaded:', Object.keys(exchange.markets).length);
  const symbols = Object.keys(exchange.markets).slice(0, 10);
  console.log('Sample symbols:', symbols);
  
  // Let's check some properties of the BTC/USDT:USDT market
  const btcMarket = exchange.markets['BTC/USDT:USDT'];
  if (btcMarket) {
    console.log('BTC/USDT:USDT market info:');
    console.log('id:', btcMarket.id);
    console.log('linear:', btcMarket.linear);
    console.log('inverse:', btcMarket.inverse);
    console.log('precision:', btcMarket.precision);
    console.log('limits:', btcMarket.limits);
  } else {
    console.log('BTC/USDT:USDT market not found, finding active BTC perpetual...');
    const found = Object.keys(exchange.markets).find(s => s.startsWith('BTC/'));
    console.log('Found:', found, found ? exchange.markets[found] : 'none');
  }

  // Check how setting SL/TP is done in kucoinfutures
  console.log('Has createOrder:', typeof exchange.createOrder === 'function');
  console.log('Has editOrder:', typeof exchange.editOrder === 'function');
}

check().catch(console.error);
