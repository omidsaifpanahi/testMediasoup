// wsServer.js
const WebSocket = require('ws');
const config = require('./config');
const { rooms } = require('./rooms'); // فرض بر اینکه لیست SubRoomها اینجاست

const wss = new WebSocket.Server({ port: config.wsPort || 4444 });

wss.on('connection', socket => {
  socket.on('message', async msg => {
    const data = JSON.parse(msg);

    if (data.type === 'new-producer') {
      const { producerId, rtpCapabilities, subRoomId } = data;

      const subRoom = rooms.get(subRoomId);
      if (!subRoom) {
        console.warn('Unknown SubRoom:', subRoomId);
        return;
      }

      await subRoom.pipeFromRemoteProducer(producerId, rtpCapabilities, data.serverId);
    }
  });
});

console.log(`WebSocket server listening on ${config.wsPort || 4444}`);
