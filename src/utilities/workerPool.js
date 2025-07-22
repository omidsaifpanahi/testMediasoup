// -- utils/workerPool.js

const createWorkers = require('./createWorkers');

class WorkerPool {
    constructor() {
        this._workers = []; // [{ worker, subRoomCount }]
    }

    async initialize() {
        const workers = await createWorkers();
        this._workers = workers.map(worker => ({
            worker,
            subRoomCount: 0
        }));
    }

    getLeastLoadedWorker() {
        if (this._workers.length === 0)
            throw new Error("No workers available");

        this._workers.sort((a, b) => a.subRoomCount - b.subRoomCount);
        return this._workers[0].worker;
    }

    incrementLoad(worker) {
        const entry = this._workers.find(w => w.worker.pid === worker.pid);
        if (entry) entry.subRoomCount++;
    }

    decrementLoad(worker) {
        const entry = this._workers.find(w => w.worker.pid === worker.pid);
        if (entry && entry.subRoomCount > 0) entry.subRoomCount--;
    }

    getWorkerInfo() {
        return this._workers.map(w => ({
            pid: w.worker.pid,
            subRooms: w.subRoomCount
        }));
    }
}

module.exports = new WorkerPool();
