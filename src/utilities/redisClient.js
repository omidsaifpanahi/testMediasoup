const Redis = require('ioredis');

class RedisClient {
    constructor(pass='f^0!0!b@r&e&d') {
        // Initialize Redis client with connection settings
        this.client = new Redis({
            host: '127.0.0.1', // Redis server host
            port: 6379,       // Redis server port
            password: pass,   // Password for authentication
            db: 0,            // Database index to use
        });

        // Handle Redis connection errors
        this.client.on('error', (err) => {
            console.error('Redis error:', err);
        });
    }

    // Save room data in Redis using a hash set
    async saveRoom(roomId, roomData) {
        try {
            await this.client.hset(`room:${roomId}`, roomData);
        } catch (err) {
            console.error('Error saving room to Redis:', err);
            throw err;
        }
    }

    // Retrieve room data from Redis
    async getRoom(roomId) {
        try {
            return await this.client.hgetall(`room:${roomId}`);
        } catch (err) {
            console.error('Error getting room from Redis:', err);
            throw err;
        }
    }

    // Delete room data from Redis
    async deleteRoom(roomId) {
        try {
            await this.client.del(`room:${roomId}`);
        } catch (err) {
            console.error('Error deleting room from Redis:', err);
            throw err;
        }
    }
}

module.exports = RedisClient;
