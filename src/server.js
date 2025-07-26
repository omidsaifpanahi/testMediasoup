// -- server.js
'use strict';

// -------------------------------------------------------------------------------------------------
// Environment check
// -------------------------------------------------------------------------------------------------

// Ensure that the NODE_ENV environment variable is set; otherwise, throw an error
if (!process.env['NODE_ENV']) {
    throw new Error('Environment variable NODE_ENV is missing');
} else if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'development') {

    // Ensure required environment variables are set
    // 'STREAM_CLIENT_URL', 'SENTRY_DSN'
    ['SERVER_PORT','API_GETWAY'].forEach((name) => {
        if (!process.env[name]) {
            throw new Error(`Environment variable ${name} is missing`);
        }
    });
}

// -------------------------------------------------------------------------------------------------
// Dependencies
// -------------------------------------------------------------------------------------------------

// Import required dependencies
require('express-async-errors');                  // Handles async errors in Express
const fs            = require('fs');              // File system module for reading files
const path          = require('path');            // Path module for handling file paths
const https         = require('httpolyglot');     // Allows handling both HTTP and HTTPS requests
const express       = require('express');         // Express framework for building web applications
const socketIO      = require('socket.io');       // Socket.IO for real-time WebSocket communication
const hidePoweredBy = require('hide-powered-by'); // Hides the 'X-Powered-By' header for security reasons
const compression   = require('compression');     // Enables gzip compression for responses

// Modules -----------------------------------------------------------------------------------------

// Import custom modules for configuration, logging, WebSocket handling, and metrics
const config                = require('./config/config');            // Custom configuration module
const setupSocketHandlers   = require('./socketHandlers');    // WebSocket handlers setup
const setupMetricsServer    = require('./prometheusMetrics'); // Prometheus metrics server setup
// const verifyTokenMiddleware = require('./middlewares/verifyTokenMiddleware');

// -------------------------------------------------------------------------------------------------
// Express App Setup
// -------------------------------------------------------------------------------------------------

// Create an Express application instance
const app = express();
let options = {};

// SSL setup (only used in specific environments)
if (process.env.NODE_ENV === 'development') {
    options = {
        key  : fs.readFileSync(path.join(__dirname, config.sslKey), 'utf-8'), // Load SSL private key
        cert : fs.readFileSync(path.join(__dirname, config.sslCrt), 'utf-8'), // Load SSL certificate
    };
}

// Create HTTPS server
app.use(compression()); // Enable response compression
app.use(hidePoweredBy({ setTo: 'PHP 4.2.0' })); // Set misleading 'X-Powered-By' header for security reasons
const httpsServer = https.createServer(options, app); // Create an HTTPS server

// Serve static files (public assets)
// if (process.env.NODE_ENV !== 'production') {
    app.use(express.static(path.join(__dirname, '..', 'public'))); // Serve static files in non-production environments
// } else {
    // app.get('/', (req, res) => {
    //     return res.send('Your Welcome Software Stream Server'); // Default response in production
    // });
// }

// -------------------------------------------------------------------------------------------------
// Health Check Endpoints
// -------------------------------------------------------------------------------------------------

app.get(['/readiness', '/liveness'], (_, res) => {
    res.json({ data: 'OK!' });
});

// -------------------------------------------------------------------------------------------------
// Socket Setup
// -------------------------------------------------------------------------------------------------

// Initialize Socket.IO with CORS configuration
const io = socketIO(httpsServer, {
    path        : '/webcam/', // WebSocket endpoint
    serveClient : false,      // Do not serve the client-side Socket.IO script
    log         : false,      // Disable logging
    cors        : {
        origin     : '*',             // Allow all origins (not recommended for production)
        credentials: true,            // Allow credentials
        methods    : ['GET', 'POST'], // Allowed HTTP methods
    },
});


// Global variables 
// Map to store active rooms and their associated data
let roomList = new Map();

/**
 * roomList
 * Structure to store room information:
 * {
 *   roomId: MainRoom {
 *     id: "roomId",
 *     io: SocketInstance,
 *     loadBalancer: LoadBalancerInstance,
 *     totalPeers: 0,
 *     subRooms: Map {
 *       subRoomId: SubRoom {
 *         id: "subRoomId",
 *         router: RouterInstance,      // Instance of Mediasoup Router
 *         worker: WorkerInstance,      // Assigned worker
 *         peers: Map {                 // Connected peers in this Sub-Room
 *           peerId: {
 *             id: "peerId",
 *             userId: "userId",
 *             transports: Map { transportId: TransportInstance },
 *             producers: Map { producerId: ProducerInstance },
 *             consumers: Map { consumerId: ConsumerInstance },
 *             rtpCapabilities: {}, // RTP capabilities of the peer
 *           }
 *         }
 *       }
 *     },
 *   }
 * }
 */

//  io.use(verifyTokenMiddleware);

// Setup WebSocket handlers and pass the room list
setupSocketHandlers(io, roomList);

// -------------------------------------------------------------------------------------------------
// API Routes
// -------------------------------------------------------------------------------------------------
app.get('/checkAccess', (req, res) => {
    const rooms = {
        'xkp-obmm-tvc':{
        'users':[
        
        ]},
        
        'ijn-xzqc-dyj':{
        'users':[
        
        ]},
        
        'smh-fcsp-qzv':{
        'users':[
        
        ]},
        
        'dcp-ebnf-loz':{
        'users':[
        
        ]},
        
        'hby-crsp-ujh':{
        'users':[
        
        ]},
        
        'wiy-bzpz-yao':{
        'users':[
        
        ]},   
    };

    const { roomId, userId } = req.query;
  
    if (!roomId || !userId ) {
        return res.status(400).send({ success:false,message:'مقادیر وارد نشده‌اند' });
    }
    
    if(!rooms[roomId]){
        return res.status(400).send({ success:false,message:'شناسه اتاق معتبر نیست' });      
    }
    
  
	return res.send( { success:true,message:null} );
});


// API endpoint to get room information`
app.get(['/roomInfo'], async (req, res) => {
    const roomId = req.query.roomId;

    if (!roomId) {
        return res.status(400).json({ error: 'Missing roomId parameter' });
    }

    const currentMainRoom = roomList.get(roomId);

    if (!currentMainRoom) {
        return res.status(404).json({ error: 'Room not found' });
    }

    let persons     = [];
    const subRooms  = [];
    const producers = currentMainRoom.producers;

    // Iterate over subRooms and collect their peer count
    currentMainRoom.subRooms.forEach(subRoom => {
        const peers = subRoom.getPeers();
        persons.push(...peers);

        subRooms.push({
            id         : subRoom.id,
            totalPeers : subRoom.getPeerCount(),
        });
    });

    producers.forEach(p => {
        persons.map(function(person) { 
            if(person.socketId === p.socketId){                
                let t = {           
                    mediaType:p.mediaType,
                    producerId:p.producerId
                };
                if(person['produce'])
                    person['produce'].push(t);
                else
                    person['produce'] =[t];
            }else{
                person['produce'] =[];
            }
        });
    });

    res.json({        
        subRooms,
        persons,
        producers,
    });
});


// Setup metrics server for monitoring purposes
setupMetricsServer(app, roomList);

// -------------------------------------------------------------------------------------------------
// 404 Not Found Handler
// -------------------------------------------------------------------------------------------------

app.use((req, res) => {
    res.status(404).json({ error: 'Route not found.' });
});

// -------------------------------------------------------------------------------------------------
// // Start listening for HTTPS requests
// -------------------------------------------------------------------------------------------------

httpsServer.listen(config.listenPort, () => {
    console.log('Server', {
        listening: `https://${config.listenIp}:${config.listenPort}`,
        node_version: process.versions.node, // Log the Node.js version
        num_workers : config.mediasoup.numWorkers
    });
});
