// -- loadBalancer.js

const workerLoadMap = new Map(); // Stores worker load based on worker PID

class LoadBalancer {
    constructor(workers) {
        this.workers = workers;
    }

    // Selects the worker with the least number of connections
    getWorkerWithLeastConnections() {
        let minLoad = Infinity;
        let selectedWorker = null;

        for (const worker of this.workers) {
            const load = workerLoadMap.get(worker.pid) || 0; // Get the current load of the worker
            if (load < minLoad) {
                minLoad = load;
                selectedWorker = worker; // Update the selected worker
            }
        }
        return selectedWorker;
    }

    // Updates the load of a given worker by increasing or decreasing its count
    updateWorkerLoad(worker, change) {
        const currentLoad = workerLoadMap.get(worker.pid) || 0;
        const newLoad = currentLoad + change;
        workerLoadMap.set(worker.pid, newLoad); // Store the updated load in the map
    }

    /**
     * Finds the worker with the lowest CPU usage.
     *
     * - Iterates over all workers one by one (O(n) complexity).
     * - Uses `await` inside a loop, causing sequential execution.
     * - If no workers are available, returns `undefined` (may cause an error).
     *
     * ⚠️ Optimization Note:
     * - This function calls `getResourceUsage()` sequentially, which can be slow.
     * - Consider using `Promise.all()` for parallel execution.
     *
     * @returns {Worker | undefined} The least loaded worker, or `undefined` if workers are unavailable.
     */
    async getWorkerWithLeastCpuLoad() {
            try {
                let leastLoadedWorker = null;
                let leastWorkerLoad = Infinity;

                for(let i = 0; i < this.workers.length; i++){
                    const stats    = await this.workers[i].getResourceUsage(); // Fetch resource usage stats
                    const cpuUsage = stats.ru_utime + stats.ru_stime;          // Calculate CPU usage
                    if(cpuUsage < leastWorkerLoad){
                        leastWorkerLoad   = cpuUsage;
                        leastLoadedWorker = i;        // Store the index of the worker with the lowest CPU usage
                    }
                }

                return  this.workers[leastLoadedWorker]; // Return the least loaded worker
            } catch (error) {
                console.log(error);
            }
    }


    /**
     * Selects the worker with the lowest CPU usage using `reduce`.
     *
     * - Efficient selection without sorting (O(n) complexity).
     * - Iterates through all workers once to find the least loaded one.
     *
     * @returns {Worker | null} The worker with the lowest CPU load, or null if no workers are available.
     */
    async getLeastLoadedWorkerWithReduce() {
        try {
            if (!this.workers || this.workers.length === 0) {
                throw new Error("No workers available"); // Handle case where no workers exist
            }

            const statsList = await Promise.all(this.workers.map(worker => worker.getResourceUsage())); // Fetch all workers' stats in parallel

            const leastLoadedWorkerIndex = statsList.reduce((minIndex, stats, i, arr) => {
                const cpuUsage = stats.ru_utime + stats.ru_stime;                                   // Calculate CPU usage for each worker
                return cpuUsage < (arr[minIndex].ru_utime + arr[minIndex].ru_stime) ? i : minIndex; // Find worker with the lowest CPU usage
            }, 0);

            return this.workers[leastLoadedWorkerIndex]; // Return the least loaded worker
        } catch (error) {
            console.error("Error in getWorkerWithLeastCpuLoad:", error);
            return null;
        }
    }


}

// Export LoadBalancer class for use in other modules
module.exports = LoadBalancer;