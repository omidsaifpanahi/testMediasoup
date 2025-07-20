// -- createWorkers.js

const config    = require("../config/config");    // Import configuration settings
const mediasoup = require("mediasoup");           // Import Mediasoup for WebRTC handling
const logger    = require("../utilities/logger"); // Import logger for logging events

// Function to create Mediasoup workers
const createWorkers = ()=>new Promise(async(resolve, reject)=>{
    let workers = []; // Array to store created workers

    // Set log event listeners for Mediasoup
    mediasoup.setLogEventListeners({
        onwarn: (namespace, log) => {
            logger.warn(`${namespace} ${log}`); // Log warnings
        },
        onerror: (namespace, log, error) => {
            if (error) {
                logger.error(`${namespace} ${log}: ${error}`); // Log errors with additional details
            } else {
                logger.error(`${namespace} ${log}`); // Log errors without additional details
            }
        }
    });

    // Loop to create the configured number of workers
    for (let i = 0; i < config.mediasoup.numWorkers; i++) {
        const worker = await mediasoup.createWorker({
            //rtcMinPort and max are just arbitrary ports for our traffic
            //useful for firewall or networking rules
            rtcMinPort : config.mediasoup.worker.rtcMinPort,
            rtcMaxPort : config.mediasoup.worker.rtcMaxPort,
            logLevel   : config.mediasoup.worker.logLevel, // Set log level
            logTags    : config.mediasoup.worker.logTags, // Set log tags
        });

        // Handle worker failure by automatically restarting it
        worker.on('died', async () => {
            logger.error(`Worker [pid:${worker.pid}] died. Restarting...`);
            workers[workers.indexOf(worker)] = await mediasoup.createWorker({
                logLevel: config.mediasoup.worker.logLevel,
                logTags: config.mediasoup.worker.logTags,
                rtcMinPort: config.mediasoup.worker.rtcMinPort,
                rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
            });
        });

        workers.push(worker); // Add the created worker to the list
    }
    resolve(workers); // Return the array of created workers
})


// Export the function for use in other modules
module.exports = createWorkers