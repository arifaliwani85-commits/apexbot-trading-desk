const WebSocket = require('ws');

const url = 'wss://stream.bybit.com/v5/public/linear';
const ws = new WebSocket(url);

ws.on('open', () => {
  console.log("WebSocket connected!");
  const subRequest = {
    op: 'subscribe',
    args: ['kline.5.BTCUSDT']
  };
  ws.send(JSON.stringify(subRequest));
  console.log("Subscription request sent.");
});

ws.on('message', (data) => {
  console.log("Received message:", data.toString());
  ws.close();
});

ws.on('error', (err) => {
  console.error("WebSocket error:", err);
});

ws.on('close', () => {
  console.log("WebSocket closed.");
});
