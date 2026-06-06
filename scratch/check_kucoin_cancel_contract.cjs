const ccxt = require('ccxt');

const exchange = new ccxt.kucoinfutures();
if (exchange.cancelAllContractOrders) {
  console.log('cancelAllContractOrders code check:');
  console.log(exchange.cancelAllContractOrders.toString().slice(0, 1500));
} else {
  console.log('cancelAllContractOrders does not exist');
}
