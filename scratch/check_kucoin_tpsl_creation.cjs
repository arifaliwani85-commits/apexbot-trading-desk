const ccxt = require('ccxt');

const exchange = new ccxt.kucoinfutures();

// Check what options are available in exchange.has
console.log('has createOrder:', exchange.has['createOrder']);
console.log('has createTriggerOrder:', exchange.has['createTriggerOrder']);
console.log('has createStopOrder:', exchange.has['createStopOrder']);

// Let's print out what createTriggerOrder does in kucoinfutures
if (exchange.createTriggerOrder) {
  console.log('createTriggerOrder code check:');
  console.log(exchange.createTriggerOrder.toString());
}
