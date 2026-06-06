const ccxt = require('ccxt');

const exchange = new ccxt.kucoinfutures();
if (exchange.fetchOpenOrders) {
  console.log('fetchOpenOrders code check:');
  console.log(exchange.fetchOpenOrders.toString().slice(0, 1500));
} else {
  console.log('fetchOpenOrders does not exist');
}
