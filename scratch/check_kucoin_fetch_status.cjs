const ccxt = require('ccxt');

const exchange = new ccxt.kucoinfutures();
if (exchange.fetchOrdersByStatus) {
  console.log('fetchOrdersByStatus code check:');
  const codeStr = exchange.fetchOrdersByStatus.toString();
  console.log(codeStr.slice(1000, 2500));
}
