// path: src/class/subRoom.js
const config = require('../config/config');
const logger = require('../utilities/logger');
const BaseRoom = require('./baseRoom');
module.exports = class SubRoom extends BaseRoom {
    constructor(subRoomId, worker, io, mainRoomId) {
        super(mainRoomId);
        this.mainRoomId   = mainRoomId;
        this.id           = subRoomId;
        this.worker       = worker;
        this.peers        = new Map();
        this.io           = io;
        this.router       = null;
        this.routerReady  = false;        
    }

    async init() {
        const mediaCodecs = config.mediasoup.router.mediaCodecs;
        this.router       = await this.worker.createRouter({ mediaCodecs });
        this.routerReady  = true;
    }

    addPeer(peer) {
        this.peers.set(peer.id, peer);
    }

    getRtpCapabilities() {
        return this.router.rtpCapabilities;
    }

    async createWebRtcTransport(socketId) {
        const {maxIncomingBitrate, initialAvailableOutgoingBitrate} = config.mediasoup.webRtcTransport;

        const options = {
            listenIps: config.mediasoup.webRtcTransport.listenIps,
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate
        };

        const peer = this.peers.get(socketId);
        const metaLog = {
            socketId    : socketId,
            roomId      : this.mainRoomId,
            userId      : peer?.userId,
            subRoomId   : this.id          
        };

        const transport = await this.router.createWebRtcTransport(options);
        if (maxIncomingBitrate) {
            try {
                await transport.setMaxIncomingBitrate(maxIncomingBitrate);
            } catch (error) {
                logger.error('Error setting max incoming bitrate:', {...metaLog, error: error.message});
            }
        }
        metaLog.transportId = transport.id;

        transport.on('dtlsstatechange', (dtlsState) => {
            if (dtlsState === 'closed') {
                logger.info('Transport closed by DTLS', metaLog);
                transport.close();
            }
        });

        transport.on('close', () => {
            logger.info('Transport closed', metaLog);
        });

        peer.addTransport(transport);

        return {
            params: {
                id             : transport.id,
                iceParameters  : transport.iceParameters,
                iceCandidates  : transport.iceCandidates,
                dtlsParameters : transport.dtlsParameters
            }
        };
    }

    async connectPeerTransport(socketId, transportId, dtlsParameters) {
        if (!this.peers.has(socketId)) {
            return { success: false, message: `User not found` };
        }

        return await this.peers.get(socketId).connectTransport(transportId, dtlsParameters);
    }

    async produce(socketId, producerTransportId, rtpParameters, kind, mediaType) {
        const peer = this.peers.get(socketId);
        if (!peer) {
            return { success: false, message: `User with socketId not found` };
        }

        return await peer.createProducer(producerTransportId, rtpParameters, kind, mediaType);
    }

    async consume(socketId, consumerTransportId, rtpCapabilities, producer, subRoomId) {
        if (!this.router.canConsume({ producerId: producer.producerId, rtpCapabilities })) {
            return { success: false, message: `Peer cannot consume producer` };
        }

        try {
            const peer = this.peers.get(socketId);
            if (!peer) {
                return { success: false, message: `User with socketId not found` };
            }

            const result = await peer.createConsumer(consumerTransportId, producer.producerId, rtpCapabilities);

            if (!result.success) return result;

            result.consumer.on('producerclose', () => {
                if (this.peers.has(socketId)) {
                    const peer = this.peers.get(socketId);
                    peer.removeConsumer(result.consumer.id);

                    const metaLog = {
                        socketId,
                        userId     : peer.userId,
                        consumerId : result['consumer'].id,
                        producer
                    };

                    logger.info('Consumer closed due to producer close event', {...metaLog, roomId: this.mainRoomId, subRoomId});
                    this.io.to(socketId).emit('consumerClosed', metaLog);
                }
            });

            return { success: true, params: result.params };
        } catch (error) {
            return { success: false, message: `Failed to create consumer: ${error.message}` };
        }
    }

    async removePeer(socketId) {
        if (this.peers.has(socketId)) {
            const peer = this.peers.get(socketId);
            const result = peer.close();
            if (result.success) {
                this.peers.delete(socketId);
            }
            return result;
        } else {
            return { success: false, message: 'Attempted to remove non-existing peer' };
        }
    }

    closeProducer(socketId, producerId) {
        return this.peers.get(socketId).closeProducer(producerId);
    }

    broadCast(socketId, name, data) {
        this.io.to(this.mainRoomId).except(socketId).emit(name, data);
    }

    getPeers() {
        const peers = [];
        this.peers.forEach(p => {
            peers.push({
                subRoomId: this.id,
                socketId: p.id,
                userId: p.userId,
                extra: p.extra,
                produce: []
            });
        });
        return peers;
    }

    getPeerCount() {
        return this.peers.size;
    }

    async close() {
        if (this.router) {
            this.router.close();
        }
        
        this.peers.forEach(peer => peer.close());
        this.peers.clear();

        await this.closePipeResources();

        logger.info(` SubRoom closed`, { roomId: this.mainRoomId, subRoomId: this.id });
    }
}