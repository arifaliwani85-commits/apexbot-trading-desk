const ccxt = require('ccxt');

const exchange = new ccxt.kucoinfutures();
console.log('kucoinfutures has:');
console.log('createTriggerOrder:', exchange.has['createTriggerOrder']);
console.log('createStopOrder:', exchange.has['createStopOrder']);
console.log('createOrder:', exchange.has['createOrder']);
console.log('editOrder:', exchange.has['editOrder']);
console.log('cancelAllOrders:', exchange.has['cancelAllOrders']);
console.log('fetchTriggerOrders:', exchange.has['fetchTriggerOrders']);
console.log('fetchOpenOrders:', exchange.has['fetchOpenOrders']);
console.log('fetchClosedOrders:', exchange.has['fetchClosedOrders']);
console.log('fetchPositions:', exchange.has['fetchPositions']);
console.log('setLeverage:', exchange.has['setLeverage']);
console.log('setMarginMode:', exchange.has['setMarginMode']);
console.log('setPositionMode:', exchange.has['setPositionMode']);
