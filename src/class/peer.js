// path: src/class/peer.js
const logger = require('../utilities/logger');

module.exports = class Peer {
    constructor(data, extra = {}) {
        this.id         = data.socketId;
        this.userId     = data.userId;
        this.transports = new Map();
        this.consumers  = new Map();
        this.producers  = new Map();
        this.closing    = false;
        this.extra      = extra;
        this.metaLog    = data;
    }

    addTransport(transport) {
        if (!transport || !transport.id) {
            logger.error('addTransport Invalid transport', this.metaLog);
            return;
        }
        this.transports.set(transport.id, transport);
    }

    async connectTransport(transportId, dtlsParameters) {
        if (!this.transports.has(transportId)) {
            return {
                success: false,
                message: `Transport not found`,
            };
        }

        try {
            const transport = this.transports.get(transportId);
            await transport.connect({ dtlsParameters });
            return {
                success: true,
                message: 'Transport connected',
            };
        } catch (error) {
            return {
                success: false,
                message: `Failed to connect transport: ${error.message}`,
            };
        }
    }

    async createProducer(producerTransportId, rtpParameters, kind, mediaType) {
        if (!this.transports.has(producerTransportId)) {
            return {
                success: false,
                message: 'Transport not found for producer',
            };
        }

        for (const [existingId, { producer, mediaType: type }] of this.producers) {
            if (type === mediaType) {
                producer.close();
                this.producers.delete(existingId);
                logger.info('Closed previous producer of same mediaType', { ...this.metaLog, mediaType });
                break;
            }
        }

        try {
            const transport = this.transports.get(producerTransportId);
            const producer  = await transport.produce({ kind, rtpParameters });
            this.producers.set(producer.id, { producer, mediaType });

            producer.on('transportclose', () => {
                logger.info('Producer transport close', { ...this.metaLog, producerId: producer.id });
                producer.close();
                this.producers.delete(producer.id);
            });

            return {
                success: true,
                message: 'Producer created',
                producerId: producer.id
            };
        } catch (error) {
            return {
                success: false,
                message: `Failed to create producer: ${error.message}`,
            };
        }
    }

    async createConsumer(consumerTransportId, producerId, rtpCapabilities) {
        if (!this.transports.has(consumerTransportId)) {
            return {
                success: false,
                message: `Transport not found for consumer: ${consumerTransportId}`,
            };
        }

        let consumerTransport = this.transports.get(consumerTransportId);

        try {
            const consumer = await consumerTransport.consume({
                producerId,
                rtpCapabilities,
                paused: false,
                preferredLayers: {
                    spatialLayer: 0,
                    temporalLayer: 0,
                },
            });

            if (consumer.type === 'simulcast') {
                await consumer.setPreferredLayers({
                    spatialLayer: 2,
                    temporalLayer: 2,
                });
            }

            this.consumers.set(consumer.id, consumer);

            consumer.on('transportclose', () => {
                logger.info('Consumer transport closed', { ...this.metaLog, consumerId: consumer.id });
                this.consumers.delete(consumer.id);
            });

            return {
                success: true,
                consumer,
                params: {
                    producerId,
                    id: consumer.id,
                    kind: consumer.kind,
                    rtpParameters: consumer.rtpParameters,
                    type: consumer.type,
                    producerPaused: consumer.producerPaused,
                },
            };
        } catch (error) {
            return {
                success: false,
                message: `Failed to create consumer: ${error.message}`,
            };
        }
    }

    closeProducer(producerId) {
        if (!this.producers.has(producerId)) {
            return {
                success: false,
                message: `Producer not found`,
            };
        }

        try {
            const producerWrapper = this.producers.get(producerId);
            producerWrapper.producer.close();
            this.producers.delete(producerId);
            return {
                success: true,
                message: 'Producer closed',
            };
        } catch (error) {
            return {
                success: false,
                message: `Failed to close producer: ${error.message}`,
            };
        }
    }

    close() {
        if (this.closing) {
            return {
                success: false,
                message: `Peer is already closing: ${this.id}`
            };
        }

        this.closing = true;

        try {
            this.producers.forEach(({ producer }) => producer.close());
            this.consumers.forEach(consumer => consumer.close());
            this.transports.forEach(transport => transport.close());

            this.producers.clear();
            this.consumers.clear();
            this.transports.clear();

            return {
                success: true,
                message: `Peer closed:  ${this.id}`,
            };
        } catch (error) {
            return {
                success: false,
                message: `Failed to close peer ${this.id}`,
                error
            };
        }
    }

    removeConsumer(consumerId) {
        if (this.consumers.has(consumerId)) {
            this.consumers.delete(consumerId);
        }
    }
};