const ccxt = require('ccxt');

const exchange = new ccxt.kucoinfutures();
if (exchange.createContractOrderRequest) {
  const codeStr = exchange.createContractOrderRequest.toString();
  const index = codeStr.indexOf('else if (hasStopLoss || hasTakeProfit)');
  if (index !== -1) {
    console.log(codeStr.slice(index, index + 1500));
  } else {
    console.log('else if not found');
  }
}
