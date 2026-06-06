const ccxt = require('ccxt');

const exchange = new ccxt.kucoinfutures();
if (exchange.handleTriggerPrices) {
  console.log('handleTriggerPrices code:');
  console.log(exchange.handleTriggerPrices.toString());
} else {
  console.log('handleTriggerPrices does not exist');
}
