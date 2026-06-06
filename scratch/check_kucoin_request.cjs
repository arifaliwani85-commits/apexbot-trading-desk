const ccxt = require('ccxt');

const exchange = new ccxt.kucoinfutures();
if (exchange.createContractOrderRequest) {
  console.log('createContractOrderRequest code check:');
  const codeStr = exchange.createContractOrderRequest.toString();
  console.log(codeStr.slice(1800, 3200));
}
