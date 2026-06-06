const ccxt = require('ccxt');

const exchange = new ccxt.kucoinfutures();
if (exchange.createContractOrder) {
  console.log('createContractOrder code check:');
  console.log(exchange.createContractOrder.toString().slice(0, 1500));
} else {
  console.log('createContractOrder does not exist, checking createOrder:');
  console.log(exchange.createOrder.toString().slice(0, 1500));
}
