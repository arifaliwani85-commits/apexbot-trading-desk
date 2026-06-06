const http = require('http');

http.get('http://127.0.0.1:3001/api/logs', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log("Server responded with status:", res.statusCode);
    console.log("Logs response:", data);
    process.exit(0);
  });
}).on('error', (err) => {
  console.error("Failed to connect to server:", err.message);
  process.exit(1);
});
