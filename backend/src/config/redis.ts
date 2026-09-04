import { createClient } from 'redis';
import { Redis as IORedis } from 'ioredis';
import { config } from './env.js';

// Official node-redis client for connect-redis session storage
export const sessionRedisClient = createClient({
  url: config.redisUrl
});

sessionRedisClient.on('error', (err: Error) => {
  console.warn('[Redis Session] Client connection warning:', err.message);
});

sessionRedisClient.on('connect', () => {
  console.log('[Redis Session] Connected successfully');
});

export const connectSessionRedis = async (): Promise<void> => {
  if (!sessionRedisClient.isOpen) {
    try {
      await sessionRedisClient.connect();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown Redis connection error';
      console.warn('[Redis Session] Initial connection warning:', message);
    }
  }
};

// Separate ioredis client instance preserved for BullMQ queues (future phases)
export const ioRedisClient = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});

ioRedisClient.on('error', (err: Error) => {
  console.warn('[IORedis Queue] Connection warning:', err.message);
});
