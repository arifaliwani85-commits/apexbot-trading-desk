const ccxt = require('ccxt');

const exchange = new ccxt.kucoinfutures();
const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(exchange));
const stopMethods = methods.filter(m => m.toLowerCase().includes('stop') || m.toLowerCase().includes('trigger') || m.toLowerCase().includes('storder'));
console.log('Stop/Trigger/StOrder related methods in kucoinfutures:');
console.log(stopMethods);
