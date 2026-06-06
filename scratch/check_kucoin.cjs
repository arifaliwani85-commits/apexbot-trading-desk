const ccxt = require('ccxt');

console.log('Available Kucoin exchanges in CCXT:');
const exchanges = ccxt.exchanges;
console.log('kucoin exists:', exchanges.includes('kucoin'));
console.log('kucoinfutures exists:', exchanges.includes('kucoinfutures'));

const exchange = new ccxt.kucoinfutures();
console.log('kucoinfutures has markets:', typeof exchange.loadMarkets === 'function');
console.log('kucoinfutures setSandboxMode:', typeof exchange.setSandboxMode === 'function');
