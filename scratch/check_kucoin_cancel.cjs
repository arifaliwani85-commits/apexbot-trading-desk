const ccxt = require('ccxt');

const exchange = new ccxt.kucoinfutures();
if (exchange.cancelAllOrders) {
  console.log('cancelAllOrders code check:');
  console.log(exchange.cancelAllOrders.toString().slice(0, 1500));
} else {
  console.log('cancelAllOrders does not exist');
}
