// path: src/class/BaseRoom.js
const PipeManagerREST = require('./pipeManagerREST');
class BaseRoom {
    constructor(mainRoomId) {
        this.mainRoomId = mainRoomId;
        this.pipeManager = new PipeManagerREST();        
        this.pipeTransports = new Map();        
        this.pipedConsumers = new Map();
    }

    addPipeTransport(transportId, transport) {
        this.pipeTransports.set(transportId, transport);
    }

    hasPipedProducer(producerId) {
        return this.pipedConsumers.has(producerId);
    }

    addPipedConsumer(producerId, consumer) {
        if (!this.pipedConsumers.has(producerId)) {
            this.pipedConsumers.set(producerId, []);
        }
        this.pipedConsumers.get(producerId).push(consumer);
    }

    async pipeProducerToLocalRouter(targetRouter, producerId, sourceRouter, options = {}) {
        try {
            const result = await sourceRouter.pipeToRouter({
                producerId,
                router: targetRouter,
                keyFrameRequestDelay: options.keyFrameRequestDelay || 1000
            });
            return { success: true, ...result };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    async pipeProducerToRemoteServer(producer, remoteServerUrl, subRoomId, localRouter) {

        const existingPipe = this.pipeManager.pipes.get(this.mainRoomId)?.get(remoteServerUrl);
        if (existingPipe?.producers?.has(producer.id)) {
            console.debug(`Producer ${producer.id} already piped to ${remoteServerUrl}`);
            return { success: true, alreadyPiped: true };
        }

        try {
            const { transport } = await this.pipeManager.pipeProducer({
                roomId: this.mainRoomId,
                subRoomId,
                producer,
                localRouter,
                remoteServerUrl
            });
            
            this.addPipeTransport(transport.id, transport);

            return { success: true };
        } catch (err) {
            console.error("Failed to pipe producer:", err);
            return { success: false, message: err.message };
        }
    }

    async removePipedProducer(producerId) {        
        if (this.pipedConsumers.has(producerId)) {
            for (const consumer of this.pipedConsumers.get(producerId)) {
                try {
                    consumer.close();
                } catch (err) {
                    console.warn("Failed to close pipedConsumer:", err.message);
                }
            }
            this.pipedConsumers.delete(producerId);
        }
            
        const roomPipes = this.pipeManager.pipes.get(this.mainRoomId);
        if (roomPipes) {
            for (const [remoteServerUrl, pipeEntry] of roomPipes.entries()) {
                if (pipeEntry.producers.has(producerId)) {
                    pipeEntry.producers.delete(producerId);
                }
            }
        }
    }

    async closePipeResources() {
        for (const transport of this.pipeTransports.values()) {
            try {
                transport.close();
            } catch (err) {
                console.warn("Error closing transport:", err.message);
            }
        }
        this.pipeTransports.clear();

        for (const consumers of this.pipedConsumers.values()) {
            for (const consumer of consumers) {
                try {
                    consumer.close();
                } catch (err) {
                    console.warn("Error closing consumer:", err.message);
                }
            }
        }
        this.pipedConsumers.clear();

        await this.pipeManager.close();
    }
}
module.exports = BaseRoom;