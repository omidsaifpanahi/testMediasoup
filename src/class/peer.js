// -- peer.js
const logger = require('../utilities/logger');

module.exports = class Peer {
    constructor(data,extra={}) {
        // Initialize the Peer object with a socket ID and user ID
        this.id = data.socketId;
        this.userId = data.userId;
        this.transports = new Map(); // Map to store WebRTC transports associated with this peer
        this.consumers = new Map(); // Map to store consumers associated with this peer
        this.producers = new Map(); // Map to store producers associated with this peer
        this.closing   = false;
        this.extra     = extra;
        this.metaLog   = data;
    }

    // Add a transport to the transports map
    addTransport(transport) {
        if (!transport || !transport.id) {
            logger.error('addTransport Invalid transport',this.metaLog);
            return;
        }
        this.transports.set(transport.id, transport);
    }

    // Connect a transport using the provided DTLS parameters
    async connectTransport(transportId, dtlsParameters) {
        // Check if transport exists
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

    // Create a producer for sending media
    async createProducer(producerTransportId, rtpParameters, kind,mediaType) {
        if (!this.transports.has(producerTransportId)) {
            return {
                success: false,
                message: 'Transport not found for producer',
            };
        }

        try {
            const transport = this.transports.get(producerTransportId);
            const producer  = await transport.produce({kind, rtpParameters});
            // Add the producer to the producers map
            this.producers.set(producer.id, {producer, mediaType});

            // Handle the transport close event for the producer
            producer.on('transportclose', () => {
                logger.info('Producer transport close', {...this.metaLog,producerId: producer.id});
                producer.close();
                this.producers.delete(producer.id); // Remove it from the map
            });

            return {
                success: true,
                message: 'Producer created',
                producerId : producer.id
            };
        } catch (error) {
            return {
                success: false,
                message: `Failed to create producer: ${error.message}`,
            };
        }
    }

    // Create a consumer for receiving media
    async createConsumer(consumerTransportId, producerId, rtpCapabilities) {
        if (!this.transports.has(consumerTransportId)) {
            return {
                success: false,
                message: `Transport not found for consumer: ${consumerTransportId}`,
            };
        }

        let consumerTransport = this.transports.get(consumerTransportId); // Retrieve the transport for consuming

        try {
            // Consume media from the producer
            const consumer = await consumerTransport.consume({
                producerId: producerId,
                rtpCapabilities,
                paused: false, // Auto-play media (unpaused by default) , producer.kind === 'video'
                preferredLayers: {
                    spatialLayer: 0,
                    temporalLayer: 0,
                },
            });

            // Set preferred layers for simulcast streams (if applicable)
            if (consumer.type === 'simulcast') {
                //https://www.w3.org/TR/webrtc-svc/
                await consumer.setPreferredLayers({
                    spatialLayer: 2,
                    temporalLayer: 2,
                });
            }

            // Add the consumer to the consumers map
            this.consumers.set(consumer.id, consumer);

            // Handle transport close event for the consumer
            consumer.on('transportclose', () => {
                logger.info('Consumer transport closed', { ...this.metaLog,consumerId: consumer.id});
                this.consumers.delete(consumer.id); // Remove the consumer from the map
            });


            // Return the consumer and its parameters
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

    // Close a specific producer
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
            this.producers.delete(producerId); // Remove the producer from the map
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

    // Close all transports and clean up resources
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
                message:`Failed to close peer ${this.id}`,
                error
            };
        }
    }

    // Remove a consumer from the consumers map
    removeConsumer(consumerId) {
        if (this.consumers.has(consumerId)) {
            this.consumers.delete(consumerId);
        }
    }
};
