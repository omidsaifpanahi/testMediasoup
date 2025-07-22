// -- class/BaseRoom.js
const PipeManagerREST = require('../pipe/PipeManagerREST');

class BaseRoom {
    constructor(mainRoomId) {
        this.mainRoomId     = mainRoomId;             // برای SubRoom استفاده می‌شود
        this.pipeManager    = new PipeManagerREST();  // مسئول مدیریت ارتباط با سرور دیگر
        this.pipeTransports = new Map();              // transportId => transport
        this.pipedConsumers = new Map();              // producerId => [consumer]
    }

    addPipeTransport(transportId, transport) {
        this.pipeTransports.set(transportId, transport);
    }

    addPipedConsumer(producerId, consumer) {
        if (!this.pipedConsumers.has(producerId)) {
            this.pipedConsumers.set(producerId, []);
        }
        this.pipedConsumers.get(producerId).push(consumer);
    }

    async pipeProducerToRemoteServer(producer, remoteServerUrl, localRouter) {
        await this.pipeManager.pipeProducer({
            roomId: this.mainRoomId,
            producer,
            localRouter,
            remoteServerUrl
        });
    }

    async closePipeResources() {
        for (const transport of this.pipeTransports.values()) {
            try {
                transport.close();
            } catch (err) {}
        }
        this.pipeTransports.clear();

        for (const consumers of this.pipedConsumers.values()) {
            for (const consumer of consumers) {
                try {
                    consumer.close();
                } catch (err) {}
            }
        }
        this.pipedConsumers.clear();
    }

    getDumpPipeState() {
        return {
            pipeTransports: [...this.pipeTransports.keys()],
            pipedProducers: [...this.pipedConsumers.keys()]
        };
    }
}

module.exports = BaseRoom;