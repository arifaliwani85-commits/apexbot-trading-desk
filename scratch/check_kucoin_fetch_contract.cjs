const ccxt = require('ccxt');

const exchange = new ccxt.kucoinfutures();
if (exchange.fetchContractOrdersByStatus) {
  console.log('fetchContractOrdersByStatus code check:');
  console.log(exchange.fetchContractOrdersByStatus.toString().slice(0, 1500));
} else {
  console.log('fetchContractOrdersByStatus does not exist');
}
