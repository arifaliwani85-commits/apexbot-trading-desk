try {
  const ws = require('ws');
  console.log("ws package is available!");
} catch (e) {
  console.log("ws package is NOT available:", e.message);
}
