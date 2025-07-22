//  -- pipe/PipeManagerREST.js

const axios = require("axios");

class PipeManagerREST {
    constructor(mainRoom) {
        this.mainRoom = mainRoom;

        // Map structure: roomId => Map(remoteServerUrl => { transport })
        this.pipes = new Map();
    }

    async pipeProducerToRemoteServer(localSubRoom, producerId, remoteServerUrl) {
        const roomId = this.mainRoom.roomId;
        const localRouter = localSubRoom.router;

        const producer = localSubRoom.getProducer(producerId);
        if (!producer) {
            throw new Error(`Producer ${producerId} not found in subRoom ${localSubRoom.id}`);
        }

        if (!this.pipes.has(roomId)) {
            this.pipes.set(roomId, new Map());
        }

        const roomPipes = this.pipes.get(roomId);

        // Only create transport if not already connected to remoteServer
        if (!roomPipes.has(remoteServerUrl)) {
            // Step 1: Create local PipeTransport
            const localPipeTransport = await localRouter.createPipeTransport({ listenIp: "0.0.0.0" });

            // Step 2: Request remote server to create its PipeTransport
            const { data: remoteInfo } = await axios.post(`${remoteServerUrl}/pipe/create`, {
                roomId,
                subRoomId: localSubRoom.id,
            });

            const remoteIp = remoteInfo.ip;
            const remotePort = remoteInfo.port;

            // Step 3: Connect local to remote
            await localPipeTransport.connect({ ip: remoteIp, port: remotePort });

            // Step 4: Tell remote to connect back
            await axios.post(`${remoteServerUrl}/pipe/connect`, {
                transportId: remoteInfo.id,
                ip: localPipeTransport.tuple.localIp,
                port: localPipeTransport.tuple.localPort,
            });

            // Save local transport
            roomPipes.set(remoteServerUrl, {
                transport: localPipeTransport
            });
        }

        // Step 5: Request remote to pipe this producer
        await axios.post(`${remoteServerUrl}/pipe/pipe-producer`, {
            roomId,
            subRoomId: localSubRoom.id,
            producerId: producer.id
        });
    }
}

module.exports = PipeManagerREST;
