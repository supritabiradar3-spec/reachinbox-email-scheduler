import { Request, Response } from 'express';
import { config } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { sessionRedisClient, connectSessionRedis } from '../config/redis.js';
import { elasticsearchClient } from '../config/elasticsearch.js';
import { emailQueue } from '../queues/email.queue.js';

export interface ServiceHealthItem {
  status: 'connected' | 'ready' | 'unavailable';
  responseTimeMs: number;
}

export interface DependenciesHealthResponse {
  status: 'healthy' | 'degraded';
  services: {
    mysql: { status: 'connected' | 'unavailable'; responseTimeMs: number };
    redis: { status: 'connected' | 'unavailable'; responseTimeMs: number };
    elasticsearch: { status: 'connected' | 'unavailable'; responseTimeMs: number };
    bullmq: { status: 'ready' | 'unavailable'; responseTimeMs: number };
  };
  checkedAt: string;
}

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallbackValue: T
): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallbackValue), timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const checkMySQL = async (timeoutMs: number = 3000): Promise<ServiceHealthItem> => {
  const start = Date.now();
  try {
    const check = async (): Promise<ServiceHealthItem> => {
      await prisma.$queryRawUnsafe('SELECT 1');
      return { status: 'connected', responseTimeMs: Math.max(1, Date.now() - start) };
    };
    return await withTimeout(check(), timeoutMs, { status: 'unavailable', responseTimeMs: Math.max(1, Date.now() - start) });
  } catch {
    return { status: 'unavailable', responseTimeMs: Math.max(1, Date.now() - start) };
  }
};

export const checkRedis = async (timeoutMs: number = 3000): Promise<ServiceHealthItem> => {
  const start = Date.now();
  try {
    const check = async (): Promise<ServiceHealthItem> => {
      if (!sessionRedisClient.isOpen) {
        await connectSessionRedis();
      }
      const pong = await sessionRedisClient.ping();
      if (pong === 'PONG') {
        return { status: 'connected', responseTimeMs: Math.max(1, Date.now() - start) };
      }
      return { status: 'unavailable', responseTimeMs: Math.max(1, Date.now() - start) };
    };
    return await withTimeout(check(), timeoutMs, { status: 'unavailable', responseTimeMs: Math.max(1, Date.now() - start) });
  } catch {
    return { status: 'unavailable', responseTimeMs: Math.max(1, Date.now() - start) };
  }
};

export const checkElasticsearch = async (timeoutMs: number = 3000): Promise<ServiceHealthItem> => {
  const start = Date.now();
  try {
    const check = async (): Promise<ServiceHealthItem> => {
      const isAlive = await elasticsearchClient.ping();
      if (isAlive) {
        return { status: 'connected', responseTimeMs: Math.max(1, Date.now() - start) };
      }
      return { status: 'unavailable', responseTimeMs: Math.max(1, Date.now() - start) };
    };
    return await withTimeout(check(), timeoutMs, { status: 'unavailable', responseTimeMs: Math.max(1, Date.now() - start) });
  } catch {
    return { status: 'unavailable', responseTimeMs: Math.max(1, Date.now() - start) };
  }
};

export const checkBullMQ = async (timeoutMs: number = 3000): Promise<ServiceHealthItem> => {
  const start = Date.now();
  try {
    const check = async (): Promise<ServiceHealthItem> => {
      await emailQueue.waitUntilReady();
      await emailQueue.getJobCounts();
      return { status: 'ready', responseTimeMs: Math.max(1, Date.now() - start) };
    };
    return await withTimeout(check(), timeoutMs, { status: 'unavailable', responseTimeMs: Math.max(1, Date.now() - start) });
  } catch {
    return { status: 'unavailable', responseTimeMs: Math.max(1, Date.now() - start) };
  }
};

export const getHealth = (_req: Request, res: Response): void => {
  res.status(200).json({
    status: 'ok',
    service: 'reachinbox-email-scheduler-backend',
    phase: 1,
    environment: config.nodeEnv,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
};

export const getDependenciesHealth = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [mysqlRes, redisRes, esRes, bullmqRes] = await Promise.allSettled([
      checkMySQL(),
      checkRedis(),
      checkElasticsearch(),
      checkBullMQ()
    ]);

    const mysql = mysqlRes.status === 'fulfilled' ? mysqlRes.value : { status: 'unavailable' as const, responseTimeMs: 0 };
    const redis = redisRes.status === 'fulfilled' ? redisRes.value : { status: 'unavailable' as const, responseTimeMs: 0 };
    const elasticsearch = esRes.status === 'fulfilled' ? esRes.value : { status: 'unavailable' as const, responseTimeMs: 0 };
    const bullmq = bullmqRes.status === 'fulfilled' ? bullmqRes.value : { status: 'unavailable' as const, responseTimeMs: 0 };

    const isHealthy =
      mysql.status === 'connected' &&
      redis.status === 'connected' &&
      elasticsearch.status === 'connected' &&
      bullmq.status === 'ready';

    const response: DependenciesHealthResponse = {
      status: isHealthy ? 'healthy' : 'degraded',
      services: {
        mysql: {
          status: mysql.status as 'connected' | 'unavailable',
          responseTimeMs: mysql.responseTimeMs
        },
        redis: {
          status: redis.status as 'connected' | 'unavailable',
          responseTimeMs: redis.responseTimeMs
        },
        elasticsearch: {
          status: elasticsearch.status as 'connected' | 'unavailable',
          responseTimeMs: elasticsearch.responseTimeMs
        },
        bullmq: {
          status: bullmq.status as 'ready' | 'unavailable',
          responseTimeMs: bullmq.responseTimeMs
        }
      },
      checkedAt: new Date().toISOString()
    };

    res.status(200).json(response);
  } catch {
    res.status(200).json({
      status: 'degraded',
      services: {
        mysql: { status: 'unavailable', responseTimeMs: 0 },
        redis: { status: 'unavailable', responseTimeMs: 0 },
        elasticsearch: { status: 'unavailable', responseTimeMs: 0 },
        bullmq: { status: 'unavailable', responseTimeMs: 0 }
      },
      checkedAt: new Date().toISOString()
    });
  }
};
