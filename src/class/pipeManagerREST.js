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
        this.pipes = new Map();
        this.failedServers = new Map();
        this.FAIL_CACHE_TTL = 60 * 1000;
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

        let localPipeTransport;
        try {
            if (!roomPipes.has(remoteServerUrl)) {
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

                roomPipes.set(remoteServerUrl, { transport: localPipeTransport });
            } else {
                localPipeTransport = roomPipes.get(remoteServerUrl).transport;
            }

            await axios.post(`${remoteServerUrl}/pipe/pipe-producer`, {
                roomId,
                subRoomId,
                producerId: producer.id
            });
            
            if (this.failedServers.has(remoteServerUrl)) {
                this.failedServers.delete(remoteServerUrl);
            }

            return { transport: localPipeTransport };

        } catch (err) {            
            if (localPipeTransport) {
                try {
                    localPipeTransport.close();
                } catch (_) {}
            }
            this.failedServers.set(remoteServerUrl, Date.now());
            throw new Error(`[pipeProducer] Failed with remote server ${remoteServerUrl}: ${err.message}`);
        }
    }

    async close() {
        for (const roomPipes of this.pipes.values()) {
            for (const { transport } of roomPipes.values()) {
                try {
                    transport.close();
                } catch (err) {
                    console.warn("Failed to close transport:", err.message);
                }
            }
        }
        this.pipes.clear();
        this.failedServers.clear();
    }
}

module.exports = PipeManagerREST;