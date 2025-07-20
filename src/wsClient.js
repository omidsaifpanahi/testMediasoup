// wsClient.js
const WebSocket = require('ws');
const config = require('./config');

const wsConnections = new Map();

for (const server of config.remoteServers) {
  const ws = new WebSocket(`ws://${server.ip}:${server.wsPort}`);

  ws.on('open', () => {
    console.log(`Connected to ${server.id}`);
  });

  ws.on('error', err => {
    console.error(`WS error to ${server.id}:`, err.message);
  });

  wsConnections.set(server.id, ws);
}

function sendToServer(serverId, message) {
  const ws = wsConnections.get(serverId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

module.exports = { sendToServer };
