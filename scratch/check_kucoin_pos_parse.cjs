const ccxt = require('ccxt');

const exchange = new ccxt.kucoinfutures();
if (exchange.parsePosition) {
  console.log('parsePosition code:');
  console.log(exchange.parsePosition.toString().slice(0, 1500));
} else {
  console.log('parsePosition does not exist');
}
