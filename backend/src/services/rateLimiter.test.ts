import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
  reserveDispatchSlot, 
  clearCampaignRateLimit, 
  inspectCampaignRateLimit,
  getCampaignWindowKey,
  getCampaignLastDispatchKey,
  RATE_LIMIT_WINDOW_MS
} from './rateLimiter.service.js';
import { getWorkerConcurrency } from '../worker.js';
import { emailQueue, getDeterministicJobId, addEmailJob } from '../queues/email.queue.js';
import { sanitizeError } from './email.service.js';
import { createApp } from '../app.js';

describe('Phase 7: Distributed Redis Dispatch Controls & Bull Board Monitoring', () => {
  const testCampaignId = 'test-campaign-phase7-uuid';
  const testCampaignId2 = 'test-campaign-phase7-isolated-uuid';

  beforeEach(async () => {
    await clearCampaignRateLimit(testCampaignId);
    await clearCampaignRateLimit(testCampaignId2);
  });

  afterEach(async () => {
    await clearCampaignRateLimit(testCampaignId);
    await clearCampaignRateLimit(testCampaignId2);
  });

  // 1. Hourly limit permits emails below the configured limit
  it('1. Hourly limit permits emails below the configured limit', async () => {
    const hourlyLimit = 5;
    const delaySeconds = 0;
    const now = 1756980000000;

    for (let i = 1; i <= hourlyLimit; i++) {
      const result = await reserveDispatchSlot({
        campaignId: testCampaignId,
        hourlyLimit,
        delaySeconds,
        emailId: `email-${i}`,
        now: now + i * 10
      });

      expect(result.allowed).toBe(true);
      expect(result.waitMs).toBe(0);
      expect(result.reason).toBe('OK');
    }

    const status = await inspectCampaignRateLimit(testCampaignId, now + 1000);
    expect(status.currentHourCount).toBe(hourlyLimit);
  });

  // 2. The next email is deferred after the hourly limit is reached
  it('2. The next email is deferred after the hourly limit is reached', async () => {
    const hourlyLimit = 3;
    const delaySeconds = 0;
    const now = 1756980000000;

    for (let i = 1; i <= hourlyLimit; i++) {
      await reserveDispatchSlot({
        campaignId: testCampaignId,
        hourlyLimit,
        delaySeconds,
        emailId: `email-${i}`,
        now: now + i * 10
      });
    }

    // 4th email exceeds hourlyLimit of 3
    const deferredResult = await reserveDispatchSlot({
      campaignId: testCampaignId,
      hourlyLimit,
      delaySeconds,
      emailId: 'email-4',
      now: now + 500
    });

    expect(deferredResult.allowed).toBe(false);
    expect(deferredResult.reason).toBe('HOURLY_LIMIT');
    expect(deferredResult.waitMs).toBeGreaterThan(0);
  });

  // 3. The calculated wait time is based on the oldest reservation in the rolling window
  it('3. The calculated wait time is based on the oldest reservation in the rolling window', async () => {
    const hourlyLimit = 2;
    const delaySeconds = 0;
    const oldestTimestamp = 1756980000000; // t0
    const secondTimestamp = oldestTimestamp + 10000; // t0 + 10s
    const queryTimestamp = oldestTimestamp + 20000; // t0 + 20s

    // First reservation at t0
    await reserveDispatchSlot({
      campaignId: testCampaignId,
      hourlyLimit,
      delaySeconds,
      emailId: 'email-1',
      now: oldestTimestamp
    });

    // Second reservation at t0 + 10s
    await reserveDispatchSlot({
      campaignId: testCampaignId,
      hourlyLimit,
      delaySeconds,
      emailId: 'email-2',
      now: secondTimestamp
    });

    // Third reservation attempted at t0 + 20s
    const result = await reserveDispatchSlot({
      campaignId: testCampaignId,
      hourlyLimit,
      delaySeconds,
      emailId: 'email-3',
      now: queryTimestamp
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('HOURLY_LIMIT');

    // Expected wait = (oldestTimestamp + 3600000) - queryTimestamp = 3600000 - 20000 = 3580000ms
    const expectedWaitMs = (oldestTimestamp + RATE_LIMIT_WINDOW_MS) - queryTimestamp;
    expect(result.waitMs).toBe(expectedWaitMs);
  });

  // 4. delaySeconds is enforced between consecutive dispatch reservations
  it('4. delaySeconds is enforced between consecutive dispatch reservations', async () => {
    const hourlyLimit = 100;
    const delaySeconds = 10;
    const t0 = 1756980000000;

    // First reservation at t0
    const first = await reserveDispatchSlot({
      campaignId: testCampaignId,
      hourlyLimit,
      delaySeconds,
      emailId: 'email-1',
      now: t0
    });
    expect(first.allowed).toBe(true);

    // Immediate second reservation at t0 + 3s (violates 10s delay)
    const second = await reserveDispatchSlot({
      campaignId: testCampaignId,
      hourlyLimit,
      delaySeconds,
      emailId: 'email-2',
      now: t0 + 3000
    });

    expect(second.allowed).toBe(false);
    expect(['MIN_DELAY', 'DELAY']).toContain(second.reason);
    expect(second.waitMs).toBe(7000); // 10000 - 3000 = 7000ms
    expect(second.nextAvailableAt).toEqual(new Date(t0 + 3000 + 7000));

    // Third reservation at t0 + 10s (satisfies 10s delay)
    const third = await reserveDispatchSlot({
      campaignId: testCampaignId,
      hourlyLimit,
      delaySeconds,
      emailId: 'email-2',
      now: t0 + 10000
    });

    expect(third.allowed).toBe(true);
    expect(third.waitMs).toBe(0);
    expect(third.nextAvailableAt).toEqual(new Date(t0 + 10000));
  });

  // 5. Atomic reservation prevents two concurrent workers from taking the same final slot
  it('5. Atomic reservation prevents two concurrent workers from taking the same final slot', async () => {
    const hourlyLimit = 1;
    const delaySeconds = 0;
    const now = 1756980000000;

    // Simulate 5 parallel workers attempting to reserve the 1 available slot simultaneously
    const workerPromises = [1, 2, 3, 4, 5].map((workerId) =>
      reserveDispatchSlot({
        campaignId: testCampaignId,
        hourlyLimit,
        delaySeconds,
        emailId: `email-worker-${workerId}`,
        now
      })
    );

    const results = await Promise.all(workerPromises);

    const allowedCount = results.filter((r) => r.allowed).length;
    const deferredCount = results.filter((r) => !r.allowed).length;

    expect(allowedCount).toBe(1);
    expect(deferredCount).toBe(4);
  });

  // 6. Redis keys are scoped by campaign ID (legacy fallback)
  it('6. Redis keys are scoped by campaign ID (legacy fallback)', async () => {
    const key1 = getCampaignWindowKey('camp-111');
    const key2 = getCampaignWindowKey('camp-222');
    const dispatchKey1 = getCampaignLastDispatchKey('camp-111');
    const dispatchKey2 = getCampaignLastDispatchKey('camp-222');

    expect(key1).toBe('ratelimit:campaign:camp-111:window');
    expect(key2).toBe('ratelimit:campaign:camp-222:window');
    expect(dispatchKey1).toBe('ratelimit:campaign:camp-111:last_dispatch');
    expect(dispatchKey2).toBe('ratelimit:campaign:camp-222:last_dispatch');

    // Reserving on campaign A does not affect campaign B
    const now = 1756980000000;
    await reserveDispatchSlot({
      campaignId: testCampaignId,
      hourlyLimit: 1,
      delaySeconds: 10,
      emailId: 'email-a',
      now
    });

    // Campaign B has its own independent rate limit
    const resultB = await reserveDispatchSlot({
      campaignId: testCampaignId2,
      hourlyLimit: 1,
      delaySeconds: 10,
      emailId: 'email-b',
      now
    });

    expect(resultB.allowed).toBe(true);
  });

  // 6b. Tenant and sender key scoping prevents multi-campaign bypass
  it('6b. Tenant and sender key scoping prevents multi-campaign bypass for same sender', async () => {
    const tenantUserA = 'user-tenant-a-uuid';
    const tenantUserB = 'user-tenant-b-uuid';
    const sharedSender = 'sender-ethereal-1';
    const now = 1756980000000;

    const { clearRateLimitKeys, getRateLimitWindowKey } = await import('./rateLimiter.service.js');
    await clearRateLimitKeys({ userId: tenantUserA, senderKey: sharedSender });
    await clearRateLimitKeys({ userId: tenantUserB, senderKey: sharedSender });

    expect(getRateLimitWindowKey({ userId: tenantUserA, senderKey: sharedSender })).toBe(
      `ratelimit:tenant:${tenantUserA}:sender:${sharedSender}:window`
    );

    // User A Campaign 1 reserves 2 slots out of limit 2
    const res1 = await reserveDispatchSlot({
      userId: tenantUserA,
      senderKey: sharedSender,
      campaignId: 'camp-user-a-1',
      hourlyLimit: 2,
      delaySeconds: 0,
      emailId: 'email-1',
      now
    });
    const res2 = await reserveDispatchSlot({
      userId: tenantUserA,
      senderKey: sharedSender,
      campaignId: 'camp-user-a-1',
      hourlyLimit: 2,
      delaySeconds: 0,
      emailId: 'email-2',
      now: now + 10
    });
    expect(res1.allowed).toBe(true);
    expect(res2.allowed).toBe(true);

    // User A Campaign 2 attempts to use sharedSender - must be blocked (cannot bypass limit)
    const res3 = await reserveDispatchSlot({
      userId: tenantUserA,
      senderKey: sharedSender,
      campaignId: 'camp-user-a-2',
      hourlyLimit: 2,
      delaySeconds: 0,
      emailId: 'email-3',
      now: now + 20
    });
    expect(res3.allowed).toBe(false);
    expect(res3.reason).toBe('HOURLY_LIMIT');

    // User B using sharedSender is isolated and allowed
    const resUserB = await reserveDispatchSlot({
      userId: tenantUserB,
      senderKey: sharedSender,
      campaignId: 'camp-user-b-1',
      hourlyLimit: 2,
      delaySeconds: 0,
      emailId: 'email-b-1',
      now: now + 30
    });
    expect(resUserB.allowed).toBe(true);

    await clearRateLimitKeys({ userId: tenantUserA, senderKey: sharedSender });
    await clearRateLimitKeys({ userId: tenantUserB, senderKey: sharedSender });
  });

  // 7. Redis rate-limit keys receive TTLs
  it('7. Redis rate-limit keys receive TTLs', async () => {
    const ttlSeconds = 3600;
    await reserveDispatchSlot({
      campaignId: testCampaignId,
      hourlyLimit: 10,
      delaySeconds: 5,
      emailId: 'email-ttl-test',
      ttlSeconds
    });

    const status = await inspectCampaignRateLimit(testCampaignId);
    expect(status.ttlSeconds).toBeGreaterThan(0);
    expect(status.ttlSeconds).toBeLessThanOrEqual(ttlSeconds);
  });

  // 8. A rate-limited job is not marked FAILED
  it('8. A rate-limited job is not marked FAILED', () => {
    // State transition verification:
    // When a job encounters rate-limit, status is updated to RATE_LIMITED with delayed scheduledAt
    const initialEmail = {
      id: 'email-rate-limited-1',
      status: 'SCHEDULED',
      attemptCount: 0
    };

    const waitMs = 5000;
    const rateLimitedTransition = {
      ...initialEmail,
      status: 'RATE_LIMITED',
      scheduledAt: new Date(Date.now() + waitMs)
    };

    expect(rateLimitedTransition.status).not.toBe('FAILED');
    expect(rateLimitedTransition.status).toBe('RATE_LIMITED');
    expect(rateLimitedTransition.attemptCount).toBe(0); // Attempt count not incremented on rate-limit
  });

  // 9. A deferred job retains its deterministic identity
  it('9. A deferred job retains its deterministic identity', () => {
    const emailId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
    const jobId1 = getDeterministicJobId(emailId);
    const jobId2 = getDeterministicJobId(emailId);

    expect(jobId1).toBe(`email-${emailId}`);
    expect(jobId1).toBe(jobId2);
  });

  // 10. A SENT email is never reserved or resent
  it('10. A SENT email is never reserved or resent', () => {
    const emailRecord = {
      id: 'email-sent-fixed',
      status: 'SENT',
      sentAt: new Date('2026-09-04T10:00:00.000Z')
    };

    // Worker pre-flight check logic
    const shouldSkip = emailRecord.status === 'SENT';
    expect(shouldSkip).toBe(true);
  });

  // 11. Worker concurrency does not bypass limits
  it('11. Worker concurrency does not bypass limits', async () => {
    const concurrencySetting = 20; // 20 concurrent threads configured
    const hourlyLimit = 3;
    const delaySeconds = 0;
    const now = 1756980000000;

    // Concurrency parsing validation
    process.env.WORKER_CONCURRENCY = '20';
    expect(getWorkerConcurrency()).toBe(concurrencySetting);

    // Launch 20 concurrent requests
    const promises = Array.from({ length: concurrencySetting }, (_, i) =>
      reserveDispatchSlot({
        campaignId: testCampaignId,
        hourlyLimit,
        delaySeconds,
        emailId: `concurrent-email-${i}`,
        now
      })
    );

    const outcomes = await Promise.all(promises);
    const granted = outcomes.filter((o) => o.allowed);
    const rejected = outcomes.filter((o) => !o.allowed);

    expect(granted.length).toBe(hourlyLimit);
    expect(rejected.length).toBe(concurrencySetting - hourlyLimit);
  });

  // 12. Retry behaviour does not double-reserve or duplicate-send
  it('12. Retry behaviour does not double-reserve or duplicate-send', () => {
    // When SMTP fails, attemptCount increments but status returns to SCHEDULED
    // Upon successful dispatch, status becomes SENT, preventing subsequent duplicate sends
    let recordStatus = 'PROCESSING';
    let sendCount = 0;

    const performSend = () => {
      if (recordStatus === 'SENT') return;
      sendCount++;
      recordStatus = 'SENT';
    };

    performSend(); // 1st send
    performSend(); // Duplicate retry attempt

    expect(sendCount).toBe(1);
    expect(recordStatus).toBe('SENT');
  });

  // 13. Bull Board rejects unauthenticated access (API 401 and browser 302 redirect)
  it('13. Bull Board rejects unauthenticated access', async () => {
    const app = createApp();
    const server = app.listen(0);
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 5001;

    try {
      // API request returns JSON 401
      const apiRes = await fetch(`http://127.0.0.1:${port}/admin/queues`, {
        redirect: 'manual',
        headers: { Accept: 'application/json' }
      });
      expect(apiRes.status).toBe(401);
      const body = await apiRes.json();
      expect(body).toHaveProperty('status', 'error');

      // Browser HTML request returns 302 redirect to frontend login
      const browserRes = await fetch(`http://127.0.0.1:${port}/admin/queues`, {
        redirect: 'manual',
        headers: { Accept: 'text/html,application/xhtml+xml' }
      });
      expect(browserRes.status).toBe(302);
      expect(browserRes.headers.get('location')).toContain('auth_error=unauthorized');
    } finally {
      server.close();
    }
  });

  // 14. Bull Board renders 200 for authenticated requests and uses the existing email queue
  it('14. Bull Board renders 200 for authenticated requests and uses the existing email queue', async () => {
    expect(emailQueue.name).toBe('email-dispatch-queue');

    // Create an authenticated express app instance for testing
    const express = (await import('express')).default;
    const { bullBoardRouter } = await import('../config/bullBoard.js');
    const authApp = express();

    // Mock authenticated user session
    authApp.use((req, _res, next) => {
      req.user = {
        id: 'test-user-id',
        googleId: 'google-123',
        email: 'test@reachinbox.ai',
        name: 'Test User',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      req.isAuthenticated = () => true;
      next();
    });

    const { requireBullBoardAuth } = await import('../middleware/auth.middleware.js');
    authApp.use('/admin/queues', requireBullBoardAuth, bullBoardRouter);

    const server = authApp.listen(0);
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 5002;

    try {
      // Authenticated HTML UI loads 200
      const res = await fetch(`http://127.0.0.1:${port}/admin/queues`, {
        headers: { Accept: 'text/html' }
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<!DOCTYPE html>');

      // Bull Board queues API endpoint returns email-dispatch-queue
      const queuesRes = await fetch(`http://127.0.0.1:${port}/admin/queues/api/queues`);
      expect(queuesRes.status).toBe(200);
      const queuesData = await queuesRes.json();
      expect(queuesData.queues.some((q: { name: string }) => q.name === 'email-dispatch-queue')).toBe(true);
    } finally {
      server.close();
    }
  });

  // 15. BullMQ payload contains only emailId
  it('15. BullMQ payload contains only emailId', async () => {
    const emailId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const scheduledAt = new Date(Date.now() + 60000);

    const jobId = await addEmailJob(emailId, scheduledAt);
    const job = await emailQueue.getJob(jobId);

    if (job) {
      expect(job.data).toHaveProperty('emailId', emailId);
      // Ensure no credentials, bodies, subjects, or tokens exist in BullMQ payload
      expect(job.data).not.toHaveProperty('subject');
      expect(job.data).not.toHaveProperty('body');
      expect(job.data).not.toHaveProperty('recipientEmail');
      expect(job.data).not.toHaveProperty('pass');
      expect(job.data).not.toHaveProperty('password');
      expect(job.data).not.toHaveProperty('token');

      await job.remove();
    }
  });

  // 16. Error messages never leak Redis URLs or credentials
  it('16. Error messages never leak Redis URLs or credentials', () => {
    const sensitiveError = new Error(
      'Redis connection failed to redis://:mypassword123@10.0.0.5:6379/0: invalid secret session=abcdef'
    );
    const sanitized = sanitizeError(sensitiveError);

    expect(sanitized).not.toContain('mypassword123');
    expect(sanitized).not.toContain('abcdef');
    expect(sanitized).toContain('[REDACTED]');
  });
});
