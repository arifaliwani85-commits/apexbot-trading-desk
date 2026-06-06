const ccxt = require('ccxt');

const exchange = new ccxt.kucoinfutures();
if (exchange.createContractOrderRequest) {
  const codeStr = exchange.createContractOrderRequest.toString();
  // Find where triggerPrice is handled and print the surrounding lines
  const index = codeStr.indexOf('if (triggerPrice)');
  if (index !== -1) {
    console.log(codeStr.slice(index - 100, index + 800));
  } else {
    console.log('if (triggerPrice) not found');
  }
}
