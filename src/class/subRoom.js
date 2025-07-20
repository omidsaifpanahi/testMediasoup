// -- subRoom.js
const config = require('../config/config');
const logger = require('../utilities/logger');

module.exports = class SubRoom {
    constructor(subRoomId, worker, io, mainRoomId) {
        this.mainRoomId   = mainRoomId;
        this.id           = subRoomId;
        this.worker       = worker;
        this.peers        = new Map();    // Map to manage connected peers in the room
        this.io           = io;          // Reference to the Socket.IO server instance

        // Create a router for media management
        const mediaCodecs = config.mediasoup.router.mediaCodecs;
        worker.createRouter({mediaCodecs}).then((router) => {
            this.router = router; // Store the router instance
        });
    }

    // Add a new peer to the room
    addPeer(peer) {
        this.peers.set(peer.id, peer);
    }

    // Get the RTP capabilities of the router for clients
    getRtpCapabilities() {
        return this.router.rtpCapabilities;
    }

    // Create a WebRTC transport for a specific peer
    async createWebRtcTransport(socketId) {
        const {maxIncomingBitrate, initialAvailableOutgoingBitrate} = config.mediasoup.webRtcTransport;

        const options = {
            listenIps: config.mediasoup.webRtcTransport.listenIps,
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate
        };

        const metaLog = {
            socketId    : socketId,
            roomId      : this.mainRoomId,
            userId      : this.peers.get(socketId).userId,
            subRoomId   : this.id          
        };

        // Create the WebRTC transport
        const transport = await this.router.createWebRtcTransport(options);
        if (maxIncomingBitrate)
        {
            try {
                // Set maximum incoming bitrate if specified
                await transport.setMaxIncomingBitrate(maxIncomingBitrate);
            } catch (error) {
                logger.error('Error setting max incoming bitrate:', {...metaLog, error: error.message});
            }
        }
        metaLog['transportId'] = transport.id;

        // Handle state changes in the transport's DTLS connection
        transport.on('dtlsstatechange', (dtlsState) => {
            if (dtlsState === 'closed') {
                logger.info('Transport close',metaLog );
                transport.close(); // Close the transport if DTLS is closed
            }
        });

        // Log and handle transport closure
        transport.on('close', () => {
            logger.info('Transport close', metaLog);
        });


        // Add the transport to the peer's transport list
        this.peers.get(socketId).addTransport(transport);

        // Return transport parameters to the client
        return {
            params: {
                id             : transport.id,
                iceParameters  : transport.iceParameters,
                iceCandidates  : transport.iceCandidates,
                dtlsParameters : transport.dtlsParameters
            }
        };
    }

    // Connect a peer's transport using DTLS parameters
    async connectPeerTransport(socketId, transportId, dtlsParameters) {
        if (!this.peers.has(socketId))
        {
            return {
                success : false,
                message : `User not found`
            };
        }

        // Connect the specified transport for the peer
        return await this.peers.get(socketId).connectTransport(transportId, dtlsParameters);
    }

    // Create a producer for a peer
    async produce(socketId, producerTransportId, rtpParameters, kind, mediaType) {
        
        // Attempt to get the peer and create a producer
        const peer = this.peers.get(socketId);

        if (!peer)
        {
            return {
                success : false,
                message : `User with socketId not found`,
            };
        }

        return  await peer.createProducer(producerTransportId, rtpParameters, kind, mediaType);
    }

    // Create a consumer for a peer to receive media from a producer
    async consume(socketId, consumerTransportId, rtpCapabilities,producer,subRoomId) {
        if (!this.router.canConsume({producerId: producer.producerId, rtpCapabilities})) {
            return {
                success : false,
                message : `Peer cannot consume producer`,
            };
        }

        try {
            const peer = this.peers.get(socketId);
            if (!peer) {
                return {
                    success : false,
                    message : `User with socketId not found`,
                };
            }

            const result = await peer.createConsumer(consumerTransportId, producer.producerId, rtpCapabilities,);

            if(!result['success'])
                return result;

            // Handle the case when the producer is closed
            result['consumer'].on('producerclose', () => {

                if (this.peers.has(socketId))
                {
                    const peer = this.peers.get(socketId);

                    peer.removeConsumer(result['consumer'].id);

                    const metaLog = {
                        socketId,
                        userId     : peer.userId,
                        consumerId : result['consumer'].id,
                        producer
                    };

                    logger.info('Consumer closed due to producer close event', {...metaLog,roomId:this.mainRoomId,subRoomId});

                    this.io.to(socketId).emit('consumerClosed', metaLog);
                }
            });

            return {
                success : true,
                params : result['params']
            };
        } catch (error) {
            return {
                success : false,
                message : `Failed to create consumer: ${error.message}`,
            };
        }
    }

    // Remove a peer and its associated resources from the room
    async removePeer(socketId) {
        if (this.peers.has(socketId)) {
            const peer = this.peers.get(socketId);
            const result = peer.close();
            if(result['success']){
                this.peers.delete(socketId);
            }            
            return result;            
        } else {
            return {
                success: false,
                message: 'Attempted to remove non-existing peer',
            };
        }
    }

    // Close a specific producer for a peer
    closeProducer(socketId, producerId) {
         return this.peers.get(socketId).closeProducer(producerId);
    }

    // Broadcast a message to all peers except the sender
    broadCast(socketId, name, data) {
        this.io.to(this.mainRoomId).except(socketId).emit(name, data);
    }

    // Get all connected peers in the room
    getPeers() {
        let peers = [];
        this.peers.forEach(p => {
            peers.push({
                subRoomId:this.id,
                socketId:p.id,
                userId:p.userId,
                extra:p.extra,
                produce: []
            });
        });
        return peers;
    }

    getPeerCount() {
        return this.peers.size;
    }

    close() {
        this.router.close();
        this.peers.forEach(peer => peer.close());
        this.peers.clear();
        logger.info(` SubRoom closed`,{ roomId : this.mainRoomId, subRoomId : this.id });
    }

    async  pipeFromRemoteProducer(remoteProducerId, remoteRtpCapabilities, remoteServerId) {
        const pipeTransport = await this.router.createPipeTransport({
          listenIp: '192.168.185.150', // این سرور
          enableSctp: false,
          enableRtx: true,
          enableSrtp: false
        });
      
        // فرض: IP و پورت ثابت سرور مقابل
        await pipeTransport.connect({
          ip: '192.168.185.143', // IP سرور مقابل
          port: 5000 // حتما باید pipeTransport طرف مقابل listen کنه
        });
      
        const consumer = await pipeTransport.consume({
          producerId: remoteProducerId,
          rtpCapabilities: remoteRtpCapabilities,
          paused: false
        });
      
        this.remoteConsumers.set(consumer.id, consumer);
      }
}