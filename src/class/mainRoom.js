// path: src/class/mainRoom.js
const SubRoom       = require('./subRoom');
const BaseRoom      = require('./baseRoom');
const logger        = require("../utilities/logger");
const retry         = require('retry');
const CPU_THRESHOLD = parseInt(process.env.CPU_THRESHOLD_PER_SUB_ROOM) || 75;
class MainRoom extends BaseRoom {
    constructor(roomId, io, loadBalancer) {
        super(roomId);
        this.subRooms            = new Map();
        this.id                  = roomId;
        this.io                  = io;
        this.loadBalancer        = loadBalancer;
        this.maxUsersPerSubRoom  = parseInt(process.env.MAX_USERS_PER_SUB_ROOM) || 400;
        this.lastSubRoomId       = 0;
        this.producers           = [];
        this.chatHistory         = [];
    }

    async getLeastLoadedSubRoom() {
        let leastLoadedSubRoom = null;
        let minPeerCount       = Infinity;

        for (const subRoom of this.subRooms.values()) {
            const peerCount = subRoom.getPeerCount();
            if (peerCount < this.maxUsersPerSubRoom) {
                minPeerCount       = peerCount;
                leastLoadedSubRoom = subRoom;
            }
        }

        const result = { success: false };

        if (leastLoadedSubRoom !== null) {
            if (!leastLoadedSubRoom.worker) {
                return { ...result, message: 'No worker found for subRoom ( ' + leastLoadedSubRoom.id + ' )' || 'unknown' };
            }

            try {
                const stats              = await leastLoadedSubRoom.worker.getResourceUsage();
                const totalCpuTime       = stats.ru_utime + stats.ru_stime;
                const elapsedTime        = process.hrtime()[0] * 1e6;
                const cpuUsagePercentage = (totalCpuTime / elapsedTime) * 100;

                if (cpuUsagePercentage > CPU_THRESHOLD) {
                    return { ...result, message: 'CPU usage is too high, reject this SubRoom' };
                }
            } catch (error) {
                return { ...result, message: 'Failed to get resource usage from worker:' + error.message };
            }
        }

        return { success: true, leastLoadedSubRoom };
    }

    async createSubRoom() {
        const operation = retry.operation({
            retries    : 3,
            factor     : 2,
            minTimeout : 1000,
            maxTimeout : 5000,
        });

        return new Promise((resolve) => {
            operation.attempt(async (currentAttempt) => {
                try {
                    const worker = await this.loadBalancer.getWorkerWithLeastCpuLoad();
                    if (!worker) {
                        throw new Error('No available workers to create a new sub-room');
                    }

                    const subRoomId = ++this.lastSubRoomId;
                    const subRoom   = new SubRoom(subRoomId, worker, this.io, this.id);
                    await subRoom.init();

                    this.subRooms.set(subRoomId, subRoom);
                    this.loadBalancer.updateWorkerLoad(worker, +1);

                    resolve(subRoom);
                } catch (error) {
                    if (operation.retry(error)) {
                        logger.warn(`Retrying (${currentAttempt}) to create SubRoom...`, { roomId: this.id });
                        return;
                    }
                    logger.warn('Failed to create SubRoom after retries:', { roomId: this.id, error: error.message });
                    resolve(null);
                }
            });
        });
    }

    async getTotalPeers() {
        let totalPeers = 0;
        this.subRooms.forEach(subRoom => {
            totalPeers += subRoom.getPeerCount();
        });
        return totalPeers;
    }

    async getAllPeers() {
        let persons     = [];
        const producers = this.producers;

        this.subRooms.forEach(subRoom => {
            const peers = subRoom.getPeers();
            persons.push(...peers);
        });

        producers.forEach(p => {
            persons.map(function(person) {
                if (person.socketId === p.socketId) {
                    person['produce'].push({
                        mediaType: p.mediaType,
                        producerId: p.producerId
                    });
                }
            });
        });

        return persons;
    }

    broadCast(eventName, data, fromSocketId = null) {
        if (!this.io || !this.id) return;

        if (fromSocketId) {
            this.io.to(this.id).except(fromSocketId).emit(eventName, data);
        } else {
            this.io.to(this.id).emit(eventName, data);
        }
    }

    async removeSubRoom(subRoomId) {
        const subRoom = this.subRooms.get(subRoomId);

        if (subRoom) {
            await subRoom.close();
            this.subRooms.delete(subRoomId);
            this.loadBalancer.updateWorkerLoad(subRoom.worker, -1);
        }
    }

    async destroyMainRoom() {
        for (const subRoom of this.subRooms.values()) {
            await this.removeSubRoom(subRoom.id);
        }

        await this.closePipeResources();
        this.io.to(this.id).emit('roomClosed');
    }

    getProducer(producerId) {
        const index = this.producers.findIndex(item => item.producerId === producerId);
        if (index !== -1) {
            return this.producers[index];
        }
        return null;
    }

    removeProducerByPId(producerId) {
        try {
            const index = this.producers.findIndex(item => item.producerId === producerId);
            if (index !== -1) {
                this.producers.splice(index, 1);
            }
        } catch (e) {
            console.log(e);
        }
    }

    removeProducersBySocketId(socketId) {
        this.producers = this.producers.filter(p => p.socketId !== socketId);
    }

    async pipeProducerToOtherSubRooms(sourceSubRoom, producerId) {
        for (const [, subRoom] of this.subRooms) {
            if (subRoom.id !== sourceSubRoom.id) {
                const result = await this.pipeProducerToLocalRouter(subRoom.router, producerId, sourceSubRoom.router);
                if (!result.success) {
                    throw new Error(`pipeToRouter failed from ${sourceSubRoom.id} to ${subRoom.id}: ${result.message}`);                }

            }
        }
    }

    findProducerAcrossSubRooms(producerId, excludeSubRoomId) {
        for (const [subRoomId, subRoom] of this.subRooms.entries()) {
            if (subRoomId !== excludeSubRoomId) {
                const producer = this.getProducer(producerId);
                if (producer) {
                    return { producer, router: subRoom.router };
                }
            }
        }
        return { producer: null, router: null };
    }
}
module.exports = MainRoom;