const logger = require('./utilities/logger');
const MainRoom = require('./class/mainRoom');
const Peer = require('./class/peer');
const createWorkers = require("./utilities/createWorkers");
const LoadBalancer = require('./utilities/loadBalancer');
const getLocalIp = require('./config').mediasoup.webRtcTransport.listenIps[0].announcedIp;
const { remoteServers, listenPort } = require('./config');
const myAddress = `${getLocalIp}:${listenPort}`;

module.exports = async (io, roomList) => {
    const workers = await createWorkers();
    const loadBalancer = new LoadBalancer(workers);

    io.on('connection', async (socket) => {
        try {
            const {roomId, userId} = socket.handshake.query;
            if (!roomId || !userId) {
                return disconnectWithError(socket, 'Connection missing roomId/userId');
            }

            socket.join(roomId);

            let currentMainRoom = roomList.get(roomId);

            const metaLog = {
                'socketId':socket.id,
                roomId,
                userId
            };

            if (!currentMainRoom) {
                currentMainRoom = new MainRoom(roomId, io, loadBalancer);
                roomList.set(roomId, currentMainRoom);
                logger.info(`MainRoom created`,metaLog);
            }

            let currentSubRoom = null;
            let subRoomsSize = currentMainRoom.subRooms.size;

            let isSubRoomCreated = 0;
            if (subRoomsSize === 0) {
                currentSubRoom = await currentMainRoom.createSubRoom(roomList);

                if (!currentSubRoom) {
                    return disconnectWithError(socket,'No available resources to join room');                 
                }
                metaLog['subRoomId'] = currentSubRoom.id;

                logger.info(`Created new SubRoom`,metaLog);

                isSubRoomCreated = 1;
            } else {
                const resultGetLeastLoadedSubRoom = await currentMainRoom.getLeastLoadedSubRoom();
                if (!resultGetLeastLoadedSubRoom.success) {
                    logger.info(resultGetLeastLoadedSubRoom.message,metaLog);

                    currentSubRoom = await currentMainRoom.createSubRoom();

                    if (!currentSubRoom) {
                        return disconnectWithError(socket,'No available resources to join room');
                    }
                    metaLog['subRoomId'] = currentSubRoom.id;

                    logger.info(`Created new SubRoom because getLeastLoadedSubRoom returned null`,metaLog);
                    isSubRoomCreated = 1;
                } else {
                    currentSubRoom = resultGetLeastLoadedSubRoom.leastLoadedSubRoom;
                    metaLog['subRoomId'] = currentSubRoom.id;
                    logger.info(`Reusing existing SubRoom`,metaLog);
                }
                delete resultGetLeastLoadedSubRoom;
            }

            let userExtra = {};

            if(socket.handshake.headers['user-agent'])
                userExtra['user-agent'] = socket.handshake.headers['user-agent'];

            const cookies = socket.handshake.headers.cookie;
            if (cookies) {
                const parsed = Object.fromEntries(
                cookies.split('; ').map(cookie => {
                    const [key, value] = cookie.split('=');
                    return [key, decodeURIComponent(value)];
                })
                );
                if( parsed.publicName){
                    userExtra['publicName'] = parsed.publicName;
                }

                if( parsed.avatar){
                    userExtra['avatar'] = parsed.avatar;
                }       
            }

            currentSubRoom.addPeer(new Peer(metaLog,userExtra));

            let totalPeers = await currentMainRoom.getTotalPeers();
            currentMainRoom.broadCast('roomInfo', totalPeers);
            delete totalPeers;

            currentMainRoom.broadCast('UserJoined', {
                'socketId':socket.id,
                userId,
                extra:userExtra
            },socket.id);

            logger.info('User joined', metaLog);

            socket.on('getUsers', async () => {
                let allPeers = await currentMainRoom.getAllPeers();
                socket.emit('usersList', allPeers);
                delete allPeers;
            });

            socket.on('getProducers', async () => {
                let producerList = currentMainRoom.producers;

                for (const producer of producerList) {
                    if ( producer.subRoomId !== currentSubRoom.id && isSubRoomCreated) {
                        const subRoom = currentMainRoom.subRooms.get(producer.subRoomId);
                        const alreadyPiped = currentSubRoom.pipedConsumers.has(producer.producerId);
            
                        if (!alreadyPiped) {
                            try {
                                await subRoom.router.pipeToRouter({
                                    producerId: producer.producerId,
                                    router: currentSubRoom.router,
                                    keyFrameRequestDelay: 1000
                                });
                            } catch (error) {
                                logger.warn('error on pipeToRouter in socketHandler', {...metaLog, error: error.message});
                            }
                        }
                    }
                }

                socket.emit('newProducers', producerList);
            });

            socket.on('getRouterRtpCapabilities', async (_, callback) => {
                if (!requireCallback(callback, socket,'getRouterRtpCapabilities')) return;

                try {
                    const capabilities = currentSubRoom.getRtpCapabilities();
                    logger.info('Get RouterRtpCapabilities', metaLog);
                    callback(capabilities);
                } catch (error) {
                    logger.error('Get RouterRtpCapabilities', {...metaLog, error: error.message});
                    callback({error: error.message});
                }
            });

            socket.on('createWebRtcTransport', async (_, callback) => {
                if (!requireCallback(callback, socket,'createWebRtcTransport')) return;

                try {
                    const {params} = await currentSubRoom.createWebRtcTransport(socket.id);
                    params['subRoomId'] = currentSubRoom.id
                    logger.info('Create webrtc transport', metaLog);
                    callback(params);
                } catch (error) {
                    logger.error('Error creating WebRTC Transport', {...metaLog, error: error.message});
                    callback({error: 'Failed to create WebRTC transport'});
                }
            });

            socket.on('connectTransport', async ({transportId, dtlsParameters}, callback) => {
                if (!requireCallback(callback, socket,'connectTransport')) return;

                try {
                    const {success, message} = await currentSubRoom.connectPeerTransport(socket.id, transportId, dtlsParameters);
                    if (success) {
                        logger.info(message, {...metaLog, transportId});
                        callback('success');
                    } else {
                        logger.error(message, {...metaLog, transportId});
                        callback({error: message});
                    }
                }catch (error) {
                    logger.error('on event connectTransport:', {...metaLog, error: error.message});
                    callback({error: error.message});
                }
            });

            socket.on('produce', async ({kind, rtpParameters, producerTransportId, mediaType}, callback) => {
                if (!requireCallback(callback, socket,'produce')) return;

                try {
                    const result = await currentSubRoom.produce(socket.id, producerTransportId, rtpParameters, kind, mediaType);

                    if(result['success'])
                    {
                        try {
                            await currentMainRoom.pipeProducerToOtherSubRooms(currentSubRoom, result['producerId']);                            
                        } catch (error) {
                            logger.warn('pipeToRouter failed in produce:', { ...metaLog, error: error.message });
                        }
                        
                        callback({socketId:socket.id,producerId:result['producerId']});
                        
                        for (const remote of remoteServers) {
                            const remoteAddress = remote.url.replace(/^http:\/\//, '');

                            if (remoteAddress !== myAddress) {
                                try {
                                    await currentMainRoom.pipeProducerToRemoteServer(
                                      { id: result['producerId'] },
                                      remote.url,
                                      currentSubRoom.id,
                                      currentSubRoom.router
                                    );
      
                                    logger.info("Producer piped to remote server", {
                                      ...metaLog,
                                      remoteServer: remote.url,
                                      producerId: result['producerId']
                                  });
                                  } catch (err) {
                                    logger.warn('pipeProducerToRemoteServer failed', {
                                      ...metaLog,
                                      remoteServerUrl: remote.url,
                                      error: err.message
                                    });
                                  }

                            }                            
                        }

                        logger.info(result['message'],{
                            ...metaLog,
                            transportId : producerTransportId,
                            mediaType,
                            producerId:result['producerId']});

                        const options = {
                            subRoomId : currentSubRoom.id,
                            producerId: result['producerId'],
                            userId,
                            socketId: socket.id,
                            mediaType
                        };
                        currentSubRoom.broadCast(socket.id, 'newProducers', [options]);                

                        currentMainRoom.producers.push(options);
                    }
                    else{
                        logger.error(result['message'],{
                            ...metaLog,
                            transportId : producerTransportId,
                            mediaType,
                            rtpParameters
                        });
                        callback({error: result['message']});
                    }
                } catch (error) {
                    logger.error(error, {...metaLog, mediaType,producerTransportId});

                    callback({error: error.message});
                }
            });

             socket.on('producerClosed', async ({ producerId }) => {
                const { success, message } = currentSubRoom.closeProducer(socket.id, producerId);
            
                if (success) {
                    logger.info(message, { ...metaLog, producerId });
            
                    currentMainRoom.removeProducerByPId(producerId);
                    await currentMainRoom.removePipedProducer(producerId);
                } else {
                    logger.error(message, { ...metaLog, producerId });
                }
            });

            socket.on('consume', async ({consumerTransportId, producerId, rtpCapabilities}, callback) => {
                if (!requireCallback(callback, socket,'consume')) return;

                try {
                    let producer = currentMainRoom.getProducer(producerId);
                    if (!producer) {                        
                        const found = currentMainRoom.findProducerAcrossSubRooms(producerId, currentSubRoom.id);
                        producer = found.producer;
                        if (!producer) {
                            return callback({error: 'Producer not found!'});
                        }
                    }

                    const result = await currentSubRoom.consume(socket.id, consumerTransportId, rtpCapabilities,producer,currentSubRoom.id);

                    if(result['success'])
                    {
                        logger.info('Consuming', {
                            ...metaLog,
                            producerId,
                            consumerTransportId,
                            consumerId: `${result['params'].id}`,
                        });
                        callback(result['params']);
                    }else{
                        logger.error(result['message'],{ ...metaLog, producerId, consumerTransportId });
                        callback({error: result['message']});
                    }
                } catch (error) {
                    logger.error(error,{ ...metaLog, producerId, consumerTransportId });
                    callback({error: error.message});
                }
            });

            socket.on('exitRoom', async (_, callback) => {
                const { success, message, error } = await handlePeerExit(socket, currentSubRoom, roomId, roomList, logger, currentMainRoom);
                if (success) {
                    logger.info('User exit room', metaLog);
                    if (typeof callback === 'function') callback('success');
                } else {
                    if (error){
                        logger.error('User exitRoom: ' + message, {...metaLog, error});
                    }
                    else{
                        logger.error('User exitRoom: ' + message, metaLog);
                        if (typeof callback === 'function') callback({ error: message });
                    }
                }           
            });

            socket.on('disconnect', async () => {
                const { success, message, error,logMessage } = await handlePeerExit(socket, currentSubRoom, roomId, roomList, logger, currentMainRoom);
                if (success) {
                    logger.info('User exit room', metaLog);
                    if(logMessage) logger.info(logMessage, metaLog);
                } else {
                    if (error){
                        logger.error('User disconnected: ' + message, {...metaLog, error});
                    }
                    else{
                        logger.error('User disconnected: ' + message, metaLog);
                    }
                }
            });

            socket.on('closeRoom', async (_, callback) => {
                await currentMainRoom.closePipeResources();
                await currentMainRoom.destroyMainRoom();
                roomList.delete(roomId);
                io.sockets.adapter.rooms.delete(roomId);
                logger.info('closeRoom', metaLog);
                if (!requireCallback(callback, socket, 'closeRoom')) return;
                callback('success');
            });

        } catch (err) {
            console.error('Unhandled error in connection handler:', { socketId: socket.id, error: err.message });
            socket.emit('error', 'Internal server error');
            socket.disconnect(true);
        }
    });

    async function handlePeerExit(socket, currentSubRoom, roomId, roomList, logger, mainRoomInstance) {
        try {
            mainRoomInstance.removeProducersBySocketId(socket.id);
            
            const result = await currentSubRoom.removePeer(socket.id);
            if(result['success'])
            {
                for (const producer of mainRoomInstance.producers) {
                    if (producer.socketId === socket.id) {
                        await mainRoomInstance.removePipedProducer(producer.producerId);
                    }
                }

                const totalPeers = await mainRoomInstance.getTotalPeers();

                if (totalPeers === 0 && roomList.has(roomId)) {                    
                    await mainRoomInstance.destroyMainRoom();
                    roomList.delete(roomId);
                    io.sockets.adapter.rooms.delete(roomId);
                    result['logMessage'] = `MainRoom destroyed as no peers left`;
                } else {
                    mainRoomInstance.broadCast('roomInfo', totalPeers);
                    mainRoomInstance.broadCast('userLefted', {socketId:socket.id},socket.id);
                }

                if (currentSubRoom.getPeers().size === 0) {
                    await mainRoomInstance.removeSubRoom(currentSubRoom.id);
                    result['logMessage'] = `SubRoom removed as it is empty`;                    
                }
            }
            return result;

        } catch (error) {
            return {
                success: false,
                message: 'Error handling peer exit',
                error
            };
        }
    }

    function requireCallback(callback, socket, eventName) {
        if (typeof callback !== 'function') {
            socket.emit('error', `Callback is required for ${eventName}`);
            return false;
        }
        return true;
    }

    function disconnectWithError(socket, message) {
        socket.emit('error', message);
        socket.disconnect(true);
      }
};