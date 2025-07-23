//  path: src/pipe/RemotePipeController.js
class RemotePipeController {
    constructor(mainRoom) {
        this.mainRoom = mainRoom;
        this.pipeTransports = new Map();
    }

    async createPipeTransport(req, res) {
        try {
            const { roomId, subRoomId } = req.body;
            const subRoom = this.mainRoom.subRooms.get(subRoomId);
            if (!subRoom) {
                return res.status(404).json({ error: "SubRoom not found" });
            }

            const router = subRoom.router;
            const pipeTransport = await router.createPipeTransport({ listenIp: "0.0.0.0" });

            if (!this.pipeTransports.has(roomId)) {
                this.pipeTransports.set(roomId, new Map());
            }
            this.pipeTransports.get(roomId).set(pipeTransport.id, pipeTransport);
            subRoom.addPipeTransport(pipeTransport.id, pipeTransport);

            res.json({
                id: pipeTransport.id,
                ip: pipeTransport.tuple.localIp,
                port: pipeTransport.tuple.localPort,
            });
        } catch (error) {
            console.error('Error in createPipeTransport:', error);
            res.status(500).json({ error: error.message });
        }
    }

    async connectPipeTransport(req, res) {
        try {
            const { transportId, ip, port } = req.body;

            let found = false;
            for (const roomMap of this.pipeTransports.values()) {
                if (roomMap.has(transportId)) {
                    const transport = roomMap.get(transportId);
                    await transport.connect({ ip, port });
                    found = true;
                    break;
                }
            }

            if (!found) {
                return res.status(404).json({ error: "Transport not found" });
            }

            res.json({ success: true });
        } catch (error) {
            console.error('Error in connectPipeTransport:', error);
            res.status(500).json({ error: error.message });
        }
    }

    async pipeProducer(req, res) {
        try {
            const { roomId, subRoomId, producerId } = req.body;

            const targetSubRoom = this.mainRoom.subRooms.get(subRoomId);
            if (!targetSubRoom) {
                return res.status(404).json({ error: "Target SubRoom not found" });
            }

            const { producer, router: producerRouter } = this.mainRoom.findProducerAcrossSubRooms(producerId, subRoomId);
            if (!producer) {
                return res.status(404).json({ error: "Producer not found in other SubRooms" });
            }

            const { consumer } = await targetSubRoom.router.pipeToRouter({
                producerId: producer.id,
                router: producerRouter
            });

            targetSubRoom.addPipedConsumer(producer.id, consumer);

            res.json({ success: true });
        } catch (error) {
            console.error('Error in pipeProducer:', error);
            res.status(500).json({ error: error.message });
        }
    }
}

module.exports = RemotePipeController;
