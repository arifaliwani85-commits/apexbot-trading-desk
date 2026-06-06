const ccxt = require('ccxt');

console.log("CCXT version:", ccxt.version);
if (ccxt.pro) {
  console.log("CCXT Pro is available!");
  console.log("Exchanges in CCXT Pro:", Object.keys(ccxt.pro).slice(0, 10));
} else {
  console.log("CCXT Pro is NOT available!");
}
