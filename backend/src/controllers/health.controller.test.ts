import { describe, it, expect, vi } from 'vitest';
import {
  getDependenciesHealth,
  getHealth,
  checkMySQL,
  checkRedis,
  checkElasticsearch,
  checkBullMQ
} from './health.controller.js';
import { prisma } from '../config/prisma.js';
import { sessionRedisClient } from '../config/redis.js';
import { elasticsearchClient } from '../config/elasticsearch.js';
import { emailQueue } from '../queues/email.queue.js';
import type { Request, Response } from 'express';

describe('Phase 9: Sanitized Infrastructure Health & Operations Control Center', () => {
  describe('getHealth (Public Uptime)', () => {
    it('should return 200 with public service uptime and timestamp', () => {
      const mockReq = {} as Request;
      const jsonMock = vi.fn();
      const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
      const mockRes = { status: statusMock } as unknown as Response;

      getHealth(mockReq, mockRes);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ok',
          service: 'reachinbox-email-scheduler-backend',
          uptimeSeconds: expect.any(Number),
          timestamp: expect.any(String)
        })
      );
    });
  });

  describe('checkMySQL', () => {
    it('should return connected status and response time on successful query', async () => {
      const origQueryRaw = prisma.$queryRawUnsafe;
      (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValue([{ 1: 1 }]);

      try {
        const result = await checkMySQL(1000);
        expect(result.status).toBe('connected');
        expect(result.responseTimeMs).toBeGreaterThanOrEqual(1);
      } finally {
        prisma.$queryRawUnsafe = origQueryRaw;
      }
    });

    it('should return unavailable on database error without throwing', async () => {
      const origQueryRaw = prisma.$queryRawUnsafe;
      (prisma as any).$queryRawUnsafe = vi.fn().mockRejectedValue(new Error('Connection refused'));

      try {
        const result = await checkMySQL(1000);
        expect(result.status).toBe('unavailable');
        expect(result.responseTimeMs).toBeGreaterThanOrEqual(1);
      } finally {
        prisma.$queryRawUnsafe = origQueryRaw;
      }
    });
  });

  describe('checkRedis', () => {
    it('should return connected status on successful ping', async () => {
      const origPing = sessionRedisClient.ping;
      (sessionRedisClient as any).ping = vi.fn().mockResolvedValue('PONG');

      try {
        const result = await checkRedis(1000);
        expect(result.status).toBe('connected');
        expect(result.responseTimeMs).toBeGreaterThanOrEqual(1);
      } finally {
        sessionRedisClient.ping = origPing;
      }
    });

    it('should return unavailable on Redis timeout or failure without throwing', async () => {
      const origPing = sessionRedisClient.ping;
      (sessionRedisClient as any).ping = vi.fn().mockRejectedValue(new Error('Redis timeout'));

      try {
        const result = await checkRedis(1000);
        expect(result.status).toBe('unavailable');
      } finally {
        sessionRedisClient.ping = origPing;
      }
    });
  });

  describe('checkElasticsearch', () => {
    it('should return connected status on successful ping', async () => {
      const origPing = elasticsearchClient.ping;
      (elasticsearchClient as any).ping = vi.fn().mockResolvedValue(true);

      try {
        const result = await checkElasticsearch(1000);
        expect(result.status).toBe('connected');
        expect(result.responseTimeMs).toBeGreaterThanOrEqual(1);
      } finally {
        elasticsearchClient.ping = origPing;
      }
    });

    it('should return unavailable when Elasticsearch is down', async () => {
      const origPing = elasticsearchClient.ping;
      (elasticsearchClient as any).ping = vi.fn().mockResolvedValue(false);

      try {
        const result = await checkElasticsearch(1000);
        expect(result.status).toBe('unavailable');
      } finally {
        elasticsearchClient.ping = origPing;
      }
    });
  });

  describe('checkBullMQ', () => {
    it('should return ready status on successful queue readiness and read-only job count query', async () => {
      const origWaitUntilReady = emailQueue.waitUntilReady;
      const origGetJobCounts = emailQueue.getJobCounts;

      const waitUntilReadyMock = vi.fn().mockResolvedValue(emailQueue);
      const getJobCountsMock = vi.fn().mockResolvedValue({
        waiting: 0,
        active: 0,
        completed: 10,
        failed: 0,
        delayed: 1,
        paused: 0
      });

      emailQueue.waitUntilReady = waitUntilReadyMock as any;
      emailQueue.getJobCounts = getJobCountsMock as any;

      try {
        const result = await checkBullMQ(1000);
        expect(result.status).toBe('ready');
        expect(result.responseTimeMs).toBeGreaterThanOrEqual(1);
        expect(waitUntilReadyMock).toHaveBeenCalled();
        expect(getJobCountsMock).toHaveBeenCalled();
      } finally {
        emailQueue.waitUntilReady = origWaitUntilReady;
        emailQueue.getJobCounts = origGetJobCounts;
      }
    });

    it('should return unavailable on BullMQ waitUntilReady failure without mutating jobs', async () => {
      const origWaitUntilReady = emailQueue.waitUntilReady;
      const origGetJobCounts = emailQueue.getJobCounts;

      emailQueue.waitUntilReady = vi.fn().mockRejectedValue(new Error('Redis connection failed on BullMQ')) as any;
      const getJobCountsMock = vi.fn();
      emailQueue.getJobCounts = getJobCountsMock as any;

      try {
        const result = await checkBullMQ(1000);
        expect(result.status).toBe('unavailable');
        expect(getJobCountsMock).not.toHaveBeenCalled();
      } finally {
        emailQueue.waitUntilReady = origWaitUntilReady;
        emailQueue.getJobCounts = origGetJobCounts;
      }
    });

    it('should return unavailable on BullMQ timeout', async () => {
      const origWaitUntilReady = emailQueue.waitUntilReady;
      const origGetJobCounts = emailQueue.getJobCounts;

      // Simulate a hanging promise that takes longer than the timeout
      emailQueue.waitUntilReady = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 500))) as any;
      emailQueue.getJobCounts = vi.fn().mockResolvedValue({}) as any;

      try {
        const result = await checkBullMQ(50); // 50ms timeout
        expect(result.status).toBe('unavailable');
      } finally {
        emailQueue.waitUntilReady = origWaitUntilReady;
        emailQueue.getJobCounts = origGetJobCounts;
      }
    });
  });

  describe('getDependenciesHealth (Full Aggregated Controller)', () => {
    it('should return status "healthy" when all four services respond successfully', async () => {
      const origQueryRaw = prisma.$queryRawUnsafe;
      const origRedisPing = sessionRedisClient.ping;
      const origEsPing = elasticsearchClient.ping;
      const origWaitUntilReady = emailQueue.waitUntilReady;
      const origGetJobCounts = emailQueue.getJobCounts;

      (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValue([{ 1: 1 }]);
      (sessionRedisClient as any).ping = vi.fn().mockResolvedValue('PONG');
      (elasticsearchClient as any).ping = vi.fn().mockResolvedValue(true);
      emailQueue.waitUntilReady = vi.fn().mockResolvedValue(emailQueue) as any;
      emailQueue.getJobCounts = vi.fn().mockResolvedValue({ completed: 5 }) as any;

      const mockReq = {} as Request;
      const jsonMock = vi.fn();
      const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
      const mockRes = { status: statusMock } as unknown as Response;

      try {
        await getDependenciesHealth(mockReq, mockRes);

        expect(statusMock).toHaveBeenCalledWith(200);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'healthy',
            services: {
              mysql: { status: 'connected', responseTimeMs: expect.any(Number) },
              redis: { status: 'connected', responseTimeMs: expect.any(Number) },
              elasticsearch: { status: 'connected', responseTimeMs: expect.any(Number) },
              bullmq: { status: 'ready', responseTimeMs: expect.any(Number) }
            },
            checkedAt: expect.any(String)
          })
        );
      } finally {
        prisma.$queryRawUnsafe = origQueryRaw;
        sessionRedisClient.ping = origRedisPing;
        elasticsearchClient.ping = origEsPing;
        emailQueue.waitUntilReady = origWaitUntilReady;
        emailQueue.getJobCounts = origGetJobCounts;
      }
    });

    it('should return status "degraded" when one or more dependencies are unavailable', async () => {
      const origQueryRaw = prisma.$queryRawUnsafe;
      const origRedisPing = sessionRedisClient.ping;
      const origEsPing = elasticsearchClient.ping;
      const origWaitUntilReady = emailQueue.waitUntilReady;
      const origGetJobCounts = emailQueue.getJobCounts;

      // MySQL OK, Redis fails, ES OK, BullMQ OK
      (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValue([{ 1: 1 }]);
      (sessionRedisClient as any).ping = vi.fn().mockRejectedValue(new Error('Redis connection lost'));
      (elasticsearchClient as any).ping = vi.fn().mockResolvedValue(true);
      emailQueue.waitUntilReady = vi.fn().mockResolvedValue(emailQueue) as any;
      emailQueue.getJobCounts = vi.fn().mockResolvedValue({ completed: 5 }) as any;

      const mockReq = {} as Request;
      const jsonMock = vi.fn();
      const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
      const mockRes = { status: statusMock } as unknown as Response;

      try {
        await getDependenciesHealth(mockReq, mockRes);

        expect(statusMock).toHaveBeenCalledWith(200);
        const responseData = jsonMock.mock.calls[0][0];
        expect(responseData.status).toBe('degraded');
        expect(responseData.services.mysql.status).toBe('connected');
        expect(responseData.services.redis.status).toBe('unavailable');
        expect(responseData.services.elasticsearch.status).toBe('connected');
        expect(responseData.services.bullmq.status).toBe('ready');
      } finally {
        prisma.$queryRawUnsafe = origQueryRaw;
        sessionRedisClient.ping = origRedisPing;
        elasticsearchClient.ping = origEsPing;
        emailQueue.waitUntilReady = origWaitUntilReady;
        emailQueue.getJobCounts = origGetJobCounts;
      }
    });

    it('should never expose sensitive connection strings, tokens, credentials, or stack traces in response', async () => {
      const origQueryRaw = prisma.$queryRawUnsafe;
      (prisma as any).$queryRawUnsafe = vi.fn().mockRejectedValue(new Error('mysql://secret_user:secret_password@db.host.internal:3306'));

      const mockReq = {} as Request;
      let capturedResponse: any = null;
      const jsonMock = vi.fn().mockImplementation((data) => {
        capturedResponse = data;
      });
      const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
      const mockRes = { status: statusMock } as unknown as Response;

      try {
        await getDependenciesHealth(mockReq, mockRes);
        const serialized = JSON.stringify(capturedResponse);

        expect(serialized).not.toContain('secret_user');
        expect(serialized).not.toContain('secret_password');
        expect(serialized).not.toContain('mysql://');
        expect(serialized).not.toContain('db.host.internal');
        expect(serialized).not.toContain('Error:');
        expect(serialized).not.toContain('stack');
      } finally {
        prisma.$queryRawUnsafe = origQueryRaw;
      }
    });
  });
});
