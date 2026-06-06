const ccxt = require('ccxt');

const exchange = new ccxt.kucoinfutures();
let proto = exchange;
let allMethods = [];
while (proto) {
  allMethods = allMethods.concat(Object.getOwnPropertyNames(proto));
  proto = Object.getPrototypeOf(proto);
}

const uniqueMethods = [...new Set(allMethods)];
const filtered = uniqueMethods.filter(m => {
  const lower = m.toLowerCase();
  return lower.includes('stop') || lower.includes('trigger') || lower.includes('storder') || lower.includes('position');
});
console.log('Filtered methods on kucoinfutures instance:');
console.log(filtered);
