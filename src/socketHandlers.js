// -- socketHandlers.js
const logger        = require('./utilities/logger');
const MainRoom      = require('./class/mainRoom');
const Peer          = require('./class/peer');
const createWorkers = require("./utilities/createWorkers");
const LoadBalancer  = require('./utilities/loadBalancer');
const getLocalIp    = require('./config').mediasoup.webRtcTransport.listenIps[0].announcedIp;
const { remoteServers, listenPort } = require('./config');
const myAddress = `${getLocalIp}:${listenPort}`;

module.exports = async (io, roomList) => {

    const workers      = await createWorkers();
    const loadBalancer = new LoadBalancer(workers);

    /**
     * @api {ws} /webcam/ connection Connect to WebSocket
     * @apiName Connection
     * @apiGroup Socket
     * @apiDescription This event is triggered when the client connects to the WebSocket server
     *
     * @apiQuery {Number} userId Users unique ID.
     * @apiQuery {Number} roomId
     *
     * @apiExample {javascript} Example usage:
     * const socket    = io('wss://mediaserver.zituredev.ir/?roomId=1&userId=125', {
     *   path: "/webcam/",
     *   transport : ['websocket'],
     * });
     *
     * socket.on('connect', () => {
     *    console.log('Connected');
     * });
     */

    io.on('connection', async (socket) => {
        try {
            // Extract roomId and userId from the socket handshake query.
            const {roomId, userId, role} = socket.handshake.query;
            if (!roomId || !userId) {
                return disconnectWithError(socket, 'Connection missing roomId/userId');
            }

            // Associate the roomId with the socket.
            socket.join(roomId);

            // Retrieve the current room instance.
            let currentMainRoom = roomList.get(roomId);

            const metaLog = {
                'socketId':socket.id,
                roomId,
                userId
            };

            // If the room doesn't exist, create a new MainRoom
            if (!currentMainRoom) {
                // if (role !== 'owner') {
                //     return disconnectWithError(socket, 'No available room'); 
                // }
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
                const resultGetLeastLoadedSubRoom  = await currentMainRoom.getLeastLoadedSubRoom();
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


            // Add the peer to the subRoom.
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

            // Handle request for users in the room.--------------------------------------------------------------------
            /**
             * @api {socket} roomList Get room list users
             * @apiGroup Users
             * @apiDescription Request the list of users in the room.
             */

            socket.on('getUsers', async () => {

                let allPeers   =  await currentMainRoom.getAllPeers();
                socket.emit('usersList', allPeers);
                delete allPeers;
            });


            // Handle request for producers in the room.--------------------------------------------------------------------

            /**
             * @api {socket} getProducers Get Producers
             * @apiGroup Producers
             * @apiDescription Request the list of producers in the room.
             */

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

            // Handle request for Router RTP capabilities. -----------------------------------------------------------------

            /**
             * @api {socket} getRouterRtpCapabilities Get Router RTP Capabilities
             * @apiGroup Router
             * @apiDescription Retrieve RTP capabilities from the room's router.
             */

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

            // Handle WebRTC transport creation request.--------------------------------------------------------------------

            /**
             * @api {socket} createWebRtcTransport Create WebRTC Transport
             * @apiGroup Transport
             * @apiDescription Create a new WebRTC transport for the peer.
             * @apiParam {Object} params Transport parameters.
             */

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

            // Handle transport connection request. ------------------------------------------------------------------------

            /**
             * @api {socket} connectTransport Connect Transport
             * @apiGroup Transport
             * @apiDescription Connect the peer's transport to the room.
             * @apiParam {String} transportId ID of the transport.
             * @apiParam {Object} dtlsParameters DTLS parameters.
             */

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


            // Handle transport produce media. -----------------------------------------------------------------------------

            /**
             * @api {socket} produce Produce Media
             * @apiGroup Media
             * @apiDescription Create a media producer for the peer.
             * @apiParam {String} kind Media kind (audio/video).
             * @apiParam {Object} rtpParameters RTP parameters.
             * @apiParam {String} producerTransportId ID of the producer's transport.
             *  @apiParam {String} mediaType (audio/video/screen).
             */

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

                            if (remoteAddress === myAddress) {   
                                logger.debug('Skipping pipe to self:', remote.url);                             
                                continue;
                            }
                            
                            try {
                              await currentMainRoom.pipeProducerToRemoteServer(
                                { id: result['producerId'] },
                                remote.url,
                                currentSubRoom.id,
                                currentSubRoom.router
                              );
                            } catch (err) {
                              logger.warn('pipeProducerToRemoteServer failed', {
                                ...metaLog,
                                remoteServerUrl: remote.url,
                                error: err.message
                              });
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
                        
                        
                        // Optional: Pipe to remote server if needed
                        // await currentSubRoom.pipeProducerToRemoteServer(result['producerObject'], remoteServerUrl);
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

            // Handle producer close event. --------------------------------------------------------------------------------

            /**
             * @api {socket} producerClosed Producer Closed
             * @apiGroup Media
             * @apiDescription Handle the event when a producer is closed.
             * @apiParam {String} producerId ID of the producer.
             */

            socket.on('producerClosed', ({producerId}) => {
                const {success,message} = currentSubRoom.closeProducer(socket.id, producerId);
                if(success){
                    logger.info(message,{ ...metaLog, producerId });           
                    currentMainRoom.removeProducerByPId(producerId);            
                }
                else
                    logger.error(message,{ ...metaLog, producerId });
            });

            // Handle request to consume media. ----------------------------------------------------------------------------

            /**
             * @api {socket} consume Consume Media
             * @apiGroup Media
             * @apiDescription Create a media consumer for the peer.
             * @apiParam {String} consumerTransportId ID of the consumer's transport.
             * @apiParam {String} producerId ID of the producer.
             * @apiParam {Object} rtpCapabilities RTP capabilities of the peer.
             */

            socket.on('consume', async ({consumerTransportId, producerId, rtpCapabilities}, callback) => {
                if (!requireCallback(callback, socket,'consume')) return;

                try {
                    const producer = currentMainRoom.getProducer(producerId);
                    if(producer==null){
                        callback({error: 'Producer not found!'});
                    }
                    // Create a consumer
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

            // Handle peer's request to exit the room. ---------------------------------------------------------------------

            /**
             * @api {socket} exitRoom Exit Room
             * @apiGroup Room
             * @apiDescription Handle the event when a peer exits the room.
             */

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

            // Handle socket disconnection. --------------------------------------------------------------------------------

            /**
             * @api {socket} disconnect Disconnect Event
             * @apiGroup Connection
             * @apiDescription Handle the event when a peer disconnects.
             */

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

            /**
             * @api {socket} closeRoom CloseRoom Event
             * @apiGroup Connection
             * @apiDescription Handle the event closeRoom.
             */
            socket.on('closeRoom', async (_, callback) => {
                await currentMainRoom.destroyMainRoom();
                roomList.delete(roomId);
                io.sockets.adapter.rooms.delete(roomId);
                logger.info('closeRoom', metaLog);
                if (!requireCallback(callback, socket, 'closeRoom')) return;
                callback('success');
            });

            function sanitizeMessage(msg) {
                if (typeof msg !== 'string') return null;
        
                const cleaned = msg
                    .replace(/[<>]/g, '')
                    .replace(/script/gi, '')
                    .trim()
                    .substring(0, 120);
        
                return cleaned.length > 0 ? cleaned : null;
            }
            socket.on('chat-message', async (msg) => {
                try {
                    const safeMsg = sanitizeMessage(msg);
                    if (!safeMsg) return;

                    const now = new Date();
                    const timeStr = now.toTimeString().split(' ')[0];
                
                    const trimmedMsg = {
                        userId,        
                        text: safeMsg,
                        extra: userExtra,
                        time: timeStr
                    };

                    if (!currentMainRoom.chatHistory)
                        currentMainRoom.chatHistory = [];

                    currentMainRoom.chatHistory.push(trimmedMsg);

                    if (currentMainRoom.chatHistory.length > 20) {
                        currentMainRoom.chatHistory.shift();
                    }

                    currentMainRoom.broadCast('chat-message', trimmedMsg);
                } catch (error) {
                    logger.error('chat-message handler:', {...metaLog, error : error.message});
                }
            });

            
            socket.on('chatHistory', async () => {
                socket.emit('chatHistory', currentMainRoom.chatHistory);
            });


            socket.on('reaction', (emoji) => {
                try{
                    if (typeof emoji !== 'string') return;
                    const allowedReactions = ['👍', '👏', '✋', '👎'];
                    if (!allowedReactions.includes(emoji)) return;            

                    const reactionData = {
                        emoji,
                        userId,
                        name: userExtra?.publicName || userId,
                    };        

                    currentMainRoom.broadCast('reaction', reactionData);
                }  catch (error) {
                    logger.error('reaction handler:', {...metaLog, error : error.message});
                }
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
            // Remove the peer from the room.
            const result = await currentSubRoom.removePeer(socket.id);
            if(result['success'])
            {
                const totalPeers = await mainRoomInstance.getTotalPeers();

                // If no peers are left, delete the room.
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

