const os     = require('os');
const ifaces = os.networkInterfaces();

// Function to get the local IPv4 address of the machine
const getLocalIp = () => {
    let localIp = '127.0.0.1'; // Default to localhost

    Object.keys(ifaces).forEach((ifname) => {
        for (const iface of ifaces[ifname]) {
            // Ignore IPv6 and internal addresses (e.g., 127.0.0.1)
            if (iface.family !== 'IPv4' || iface.internal !== false) {
                continue;
            }
            // Set the local IP to the first available IPv4 address
            localIp = iface.address;
            return;
        }
    });

    return localIp;
};

module.exports = {
    listenIp               : '127.0.0.1', // IP for the server to listen on
    listenPort             : process.env.SERVER_PORT || 5000, // Server port with an environment variable fallback
    sslCrt                 : '../ssl/cert.pem', // Path to SSL certificate file
    sslKey                 : '../ssl/key.pem', // Path to SSL key file
    
    mediasoup  : {
        // Worker settings
        numWorkers: Math.max(os.cpus().length - 1, 1), // Number of Mediasoup workers, at least 1
        worker: {
            rtcMinPort : 30000, // Minimum port range for WebRTC traffic
            rtcMaxPort : 60000, // Maximum port range for WebRTC traffic
            logLevel   : process.env.MEDIASOUP_LOG_LEVEL || 'error', // Log level for debugging
            logTags    : [ // Logging tags for different events
                'info',
                'ice',
                'dtls',
                'rtp',
                'srtp',
                'rtcp',
                // 'rtx',
                // 'bwe',
                // 'score',
                // 'simulcast',
                // 'svc'
            ],
        },
        
        // Router settings for Mediasoup
        router: {
            mediaCodecs: [ // List of supported media codecs
                {
                    kind       : 'audio',      // Audio codec configuration
                    mimeType   : 'audio/opus', // Opus codec for high-quality audio
                    clockRate  : 48000,        // Sample rate: 48 kHz (standard for WebRTC)
                    channels   : 2,            // Stereo audio (2 channels)
                    parameters : {
                        'minptime'     : 10,   // Minimum packetization time (ms) - affects latency and quality
                        'useinbandfec' : 1,    // Enable in-band Forward Error Correction (FEC) to improve audio robustness
                        'stereo'            : 1,        // Enable stereo
                        'sprop-stereo'      : 1,        // Signaling stereo capability
                        'maxplaybackrate'   : 48000,    // Maximum sample rate for playback
                        'maxaveragebitrate' : 128000,   // Allow higher average bitrate (up to 128kbps)
                        'cbr'               : 0,        // Use variable bitrate (for higher quality)
                        'dtx'               : 0         // Disable discontinuous transmission (prevents cut in silence)
                    },
                },
                {
                    kind       : 'video',      // Video codec configuration
                    mimeType   : 'video/VP8',  // VP8 codec (widely supported in WebRTC)
                    clockRate  : 90000,        // Clock rate for VP8 (90 kHz, standard for video)
                    parameters : {
                        'x-google-start-bitrate': 200, // Initial video bitrate in kbps (helps with quality adaptation)
                        'x-google-max-bitrate'  : 1000
                    },
                },
                // {
                //     kind       : "video",      // Alternative video codec configuration
                //     mimeType   : "video/H264", // H.264 codec (better hardware acceleration on some devices)
                //     clockRate  : 90000,        // Clock rate for H.264 (90 kHz, standard for video)
                //     parameters : {
                //         "packetization-mode": 1,      // Mode 1 allows fragmented NAL units (improves efficiency)
                //         "profile-level-id": "4d0032", // Defines H.264 profile and level (Baseline profile, Level 3.2)
                //         "level-asymmetry-allowed": 1, // Allows different encoding/decoding levels for flexibility
                //     },
                // },
            ],
        },
                
        // WebRTC Transport settings
        webRtcTransport: {
            listenIps: [ // IP configuration for WebRTC transport
                {
                    ip          : '0.0.0.0', // Bind to all available interfaces
                    announcedIp : getLocalIp(), // Publicly announced IP
                },
            ],
            probationTimeout                : 5000,    // Time to wait for a new peer (ms)
            initialAvailableOutgoingBitrate : 1000000, // Initial outgoing bitrate (bps)
            minAvailableOutgoingBitrate     : 600000,  // Minimum allowed outgoing bitrate (bps)
            maxIncomingBitrate              : 2000000, // Maximum incoming bitrate (bps)
            maxOutgoingBitrate              : 2000000, // Maximum outgoing bitrate (bps)
            maxPort                         : 60000,   // Upper port range for WebRTC
            minPort                         : 30000,   // Lower port range for WebRTC
            enableUdp                       : true,
            enableTcp                       : true,
            preferUdp                       : true,
        },
        
        // Pipe Transport settings for inter-worker communication
        pipeTransport: {
            listenIp: {
                ip          : '0.0.0.0', // Bind to all interfaces
                announcedIp : getLocalIp(), // Publicly announced IP
            },
            enableUdp: true,  // Enable UDP for transport
            enableTcp: true,  // Enable TCP for transport
            preferUdp: true,  // Prefer UDP over TCP
        },
    },
};
