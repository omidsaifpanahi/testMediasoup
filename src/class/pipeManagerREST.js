// path: src/class/pipeManagerREST.js
const axios = require("axios");
const axiosRetry = require("axios-retry");

axios.defaults.timeout = 5000;
axiosRetry(axios, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.code === 'ECONNABORTED';
    }
});

class PipeManagerREST {
    constructor() {
        this.pipes = new Map(); // roomId => Map(remoteServerUrl => { transport, producers: Set, subRoomId })
        this.failedServers = new Map(); // remoteServerUrl => timestamp
        this.FAIL_CACHE_TTL = 60 * 1000;
        this.pipeLocks = new Map(); // remoteServerUrl => Promise
    }

    isServerFailedRecently(remoteServerUrl) {
        const failTime = this.failedServers.get(remoteServerUrl);
        if (!failTime) return false;

        const now = Date.now();
        if (now - failTime < this.FAIL_CACHE_TTL) {
            return true;
        } else {
            this.failedServers.delete(remoteServerUrl);
            return false;
        }
    }

    async pipeProducer({ roomId, subRoomId, producer, localRouter, remoteServerUrl }) {
        if (this.isServerFailedRecently(remoteServerUrl)) {
            throw new Error(`Remote server ${remoteServerUrl} is in fail cache, skipping attempts`);
        }

        if (!this.pipes.has(roomId)) {
            this.pipes.set(roomId, new Map());
        }

        const roomPipes = this.pipes.get(roomId);

        const existingLock = this.pipeLocks.get(remoteServerUrl);
        if (existingLock) {
            await existingLock;
        }
    
        const pipePromise = (async () => {
            let localPipeTransport;
    
            try {
                let pipeEntry = roomPipes.get(remoteServerUrl);

                if (!pipeEntry) {
                    localPipeTransport = await localRouter.createPipeTransport({ listenIp: "0.0.0.0" });
    
                    const { data: remoteInfo } = await axios.post(`${remoteServerUrl}/pipe/create`, {
                        roomId,
                        subRoomId
                    });
    
                    await localPipeTransport.connect({
                        ip: remoteInfo.ip,
                        port: remoteInfo.port
                    });
    
                    await axios.post(`${remoteServerUrl}/pipe/connect`, {
                        transportId: remoteInfo.id,
                        ip: localPipeTransport.tuple.localIp,
                        port: localPipeTransport.tuple.localPort
                    });

                    pipeEntry = {
                        transport: localPipeTransport,
                        producers: new Set(),
                        subRoomId
                    };

                    roomPipes.set(remoteServerUrl, pipeEntry);
                } else {
                    localPipeTransport = pipeEntry.transport;

                    if (pipeEntry.producers.has(producer.id)) {
                        return { transport: localPipeTransport };
                    }
                }

                await axios.post(`${remoteServerUrl}/pipe/pipe-producer`, {
                    roomId,
                    subRoomId: pipeEntry.subRoomId,
                    producerId: producer.id
                });

                pipeEntry.producers.add(producer.id);

                if (this.failedServers.has(remoteServerUrl)) {
                    this.failedServers.delete(remoteServerUrl);
                }
    
                return { transport: localPipeTransport };
    
            } catch (err) {
                if (localPipeTransport) {
                    try { localPipeTransport.close(); } catch (_) {}
                }
    
                this.failedServers.set(remoteServerUrl, Date.now());
                throw new Error(`[pipeProducer] Failed with remote server ${remoteServerUrl}: ${err.message}`);
            }
        })();
    
        this.pipeLocks.set(remoteServerUrl, pipePromise);
    
        try {
            return await pipePromise;
        } finally {
            this.pipeLocks.delete(remoteServerUrl);
        }
    }
    

    async close() {
        for (const [roomId, roomPipes] of this.pipes.entries()) {
            for (const [remoteServerUrl, { transport }] of roomPipes.entries()) {
                try {
                    transport.close();
                } catch (err) {
                    console.warn("Failed to close local transport:", err.message);
                }
                
                try {
                    await axios.post(`${remoteServerUrl}/pipe/close`, {
                        roomId
                    });
                } catch (err) {
                    console.warn(`Failed to notify remote server ${remoteServerUrl} to close pipe:`, err.message);
                }
            }
        }
        this.pipes.clear();
        this.failedServers.clear();
    }
}

module.exports = PipeManagerREST;