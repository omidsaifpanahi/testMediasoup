// -- prometheusMetrics.js

const client = require('prom-client');

// Gauge metric to track the total number of rooms
const roomCountGauge = new client.Gauge({
    name: 'room_count',
    help: 'Total number of rooms',
});

// Gauge metric to track the number of peers in each room
const peerCountGauge = new client.Gauge({
    name: 'peer_count',
    help: 'Number of peers in each room',
    labelNames: ['room_id'],
});

// Gauge metric to track the number of video producers in each room
const producerVideoCountGauge = new client.Gauge({
    name: 'producer_video_count',
    help: 'Number of video producers in each room',
    labelNames: ['room_id'],
});

// Gauge metric to track the number of audio producers in each room
const producerAudioCountGauge = new client.Gauge({
    name: 'producer_audio_count',
    help: 'Number of audio producers in each room',
    labelNames: ['room_id'],
});

// Gauge metric to track the number of screen producers in each room
const producerScreenCountGauge = new client.Gauge({
    name: 'producer_screen_count',
    help: 'Number of screen producers in each room',
    labelNames: ['room_id'],
});

// Function to update Prometheus metrics based on the current room state
async function updateMetrics(roomList) {
    // Reset all gauges before updating values
    roomCountGauge.set(0);
    peerCountGauge.reset();
    producerVideoCountGauge.reset();
    producerAudioCountGauge.reset();
    producerScreenCountGauge.reset();

    let roomCount = 0;

    // Iterate through all rooms to collect metrics
    for (const [roomId, room] of roomList) {
        roomCount++;
        const peerCount         = await room.getTotalPeers();
        let producerScreenCount = 0;
        let producerAudioCount  = 0;
        let producerVideoCount  = 0;

        for (const producer of room.producers) {
            if (producer['mediaType'] === 'videoType')
                producerVideoCount++;
            else if (producer['mediaType'] === 'audioType')
                producerAudioCount++;
            else if (producer['mediaType'] === 'screenType')
                producerScreenCount++;
        }

        // Update gauge metrics with collected values
        peerCountGauge.set({room_id: roomId}, peerCount);
        producerVideoCountGauge.set({room_id: roomId}, producerVideoCount);
        producerAudioCountGauge.set({room_id: roomId}, producerAudioCount);
        producerScreenCountGauge.set({room_id: roomId}, producerScreenCount);
    }

    // Update the total room count
    roomCountGauge.set(roomCount);
}

// Function to set up the Prometheus metrics server
function setupMetricsServer(app, roomList) {
    // Endpoint to expose Prometheus metrics
    app.get('/metr', async (req, res) => {
        await updateMetrics(roomList);
        res.set('Content-Type', client.register.contentType);
        res.end(await client.register.metrics());
    });

    // Alternative endpoint for Mediasoup metrics
    app.get('/ms_metrics', async (req, res) => {
        await updateMetrics(roomList);
        res.set('Content-Type', client.register.contentType);
        res.end(await client.register.metrics());
    });
}

module.exports = setupMetricsServer;
