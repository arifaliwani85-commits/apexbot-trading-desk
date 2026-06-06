const ccxt = require('ccxt');

const exchange = new ccxt.kucoinfutures();
console.log('Class name:', exchange.constructor.name);
console.log('has createOrder:', typeof exchange.createOrder === 'function');

// Let's print out what createOrder does for kucoinfutures
if (exchange.createOrder) {
  console.log('createOrder code check:');
  const codeStr = exchange.createOrder.toString();
  console.log(codeStr.slice(0, 800));
}
