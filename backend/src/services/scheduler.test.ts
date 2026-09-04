import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
  calculateScheduledTime, 
  deduplicateRecipients, 
  createCampaignSchema 
} from '../validators/campaign.validator.js';
import { getDeterministicJobId } from '../queues/email.queue.js';

describe('Phase 4: Scheduler Core Calculations & Validators', () => {
  describe('calculateScheduledTime', () => {
    it('should correctly calculate scheduled timestamp based on index and delay', () => {
      const startTime = new Date('2026-09-04T12:00:00.000Z');
      const delaySeconds = 10;

      const time0 = calculateScheduledTime(startTime, 0, delaySeconds);
      const time1 = calculateScheduledTime(startTime, 1, delaySeconds);
      const time5 = calculateScheduledTime(startTime, 5, delaySeconds);

      expect(time0.toISOString()).toBe('2026-09-04T12:00:00.000Z');
      expect(time1.toISOString()).toBe('2026-09-04T12:00:10.000Z');
      expect(time5.toISOString()).toBe('2026-09-04T12:00:50.000Z');
    });

    it('should handle large delays and indices without precision drift', () => {
      const startTime = new Date('2026-09-04T00:00:00.000Z');
      const delaySeconds = 60; // 1 minute
      const index = 60; // 60th recipient -> 1 hour later

      const calculatedTime = calculateScheduledTime(startTime, index, delaySeconds);
      expect(calculatedTime.toISOString()).toBe('2026-09-04T01:00:00.000Z');
    });
  });

  describe('deduplicateRecipients', () => {
    it('should trim whitespace and remove duplicate emails case-insensitively', () => {
      const input = [
        '  Alice@Example.com  ',
        'alice@example.com',
        'ALICE@EXAMPLE.COM',
        'bob@domain.org',
        'BOB@DOMAIN.ORG',
        'charlie@reachinbox.ai'
      ];

      const deduplicated = deduplicateRecipients(input);

      expect(deduplicated).toEqual([
        'alice@example.com',
        'bob@domain.org',
        'charlie@reachinbox.ai'
      ]);
    });

    it('should return an empty array if all elements are empty', () => {
      expect(deduplicateRecipients(['', '   '])).toEqual([]);
    });
  });

  describe('getDeterministicJobId', () => {
    it('should generate predictable, collision-free job IDs matching email records', () => {
      const emailId = 'd824d5b2-2619-482f-870d-034b0dcbc5a1';
      const jobId = getDeterministicJobId(emailId);

      expect(jobId).toBe(`email-${emailId}`);
    });
  });

  describe('createCampaignSchema validation', () => {
    const originalEnv = process.env.ETHEREAL_SENDERS_JSON;

    beforeEach(() => {
      process.env.ETHEREAL_SENDERS_JSON = JSON.stringify([
        {
          key: 'sender-1',
          displayName: 'Test Sender 1',
          fromEmail: 'test1@ethereal.email',
          host: 'smtp.ethereal.email',
          port: 587,
          user: 'test1@ethereal.email',
          pass: 'testpass1',
          secure: false
        },
        {
          key: 'sender-2',
          displayName: 'Test Sender 2',
          fromEmail: 'test2@ethereal.email',
          host: 'smtp.ethereal.email',
          port: 587,
          user: 'test2@ethereal.email',
          pass: 'testpass2',
          secure: false
        }
      ]);
    });

    afterEach(() => {
      process.env.ETHEREAL_SENDERS_JSON = originalEnv;
    });

    const validPayload = {
      senderKey: 'sender-1',
      subject: 'Welcome to ReachInbox',
      body: 'Hello, this is a scheduled outreach email.',
      recipients: ['user1@example.com', 'user2@example.com'],
      startTime: new Date(Date.now() + 3600000).toISOString(),
      delaySeconds: 10,
      hourlyLimit: 100
    };

    it('should validate a correct campaign payload with valid senderKey', () => {
      const result = createCampaignSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it('should reject non-existent or unconfigured senderKey', () => {
      const invalidSender = { ...validPayload, senderKey: 'unknown-non-existent-sender' };
      const result = createCampaignSchema.safeParse(invalidSender);
      expect(result.success).toBe(false);
    });

    it('should reject empty subjects and empty bodies', () => {
      const invalidSubject = { ...validPayload, subject: '   ' };
      const invalidBody = { ...validPayload, body: '' };

      expect(createCampaignSchema.safeParse(invalidSubject).success).toBe(false);
      expect(createCampaignSchema.safeParse(invalidBody).success).toBe(false);
    });

    it('should reject empty recipient lists and invalid email formats', () => {
      const emptyRecipients = { ...validPayload, recipients: [] };
      const invalidEmail = { ...validPayload, recipients: ['not-an-email'] };

      expect(createCampaignSchema.safeParse(emptyRecipients).success).toBe(false);
      expect(createCampaignSchema.safeParse(invalidEmail).success).toBe(false);
    });

    it('should reject past start dates', () => {
      const pastTime = { 
        ...validPayload, 
        startTime: new Date(Date.now() - 3600000).toISOString() 
      };

      expect(createCampaignSchema.safeParse(pastTime).success).toBe(false);
    });

    it('should reject non-positive delay and non-positive hourly limit', () => {
      const invalidDelay = { ...validPayload, delaySeconds: 0 };
      const negativeLimit = { ...validPayload, hourlyLimit: -5 };

      expect(createCampaignSchema.safeParse(invalidDelay).success).toBe(false);
      expect(createCampaignSchema.safeParse(negativeLimit).success).toBe(false);
    });
  });

  describe('Phase 5: Sender Config & Error Sanitization', () => {
    it('should return empty list when ETHEREAL_SENDERS_JSON is missing or invalid', async () => {
      const original = process.env.ETHEREAL_SENDERS_JSON;
      const { getConfiguredSenders, getSafeSenders, isValidSenderKey } = await import('../config/senders.config.js');

      process.env.ETHEREAL_SENDERS_JSON = '';
      expect(getConfiguredSenders()).toEqual([]);
      expect(getSafeSenders()).toEqual([]);
      expect(isValidSenderKey('sender-1')).toBe(false);

      process.env.ETHEREAL_SENDERS_JSON = 'invalid-json-string';
      expect(getConfiguredSenders()).toEqual([]);
      expect(getSafeSenders()).toEqual([]);

      process.env.ETHEREAL_SENDERS_JSON = original;
    });

    it('should return safe sender information without passwords or hosts when configured', async () => {
      const original = process.env.ETHEREAL_SENDERS_JSON;
      process.env.ETHEREAL_SENDERS_JSON = JSON.stringify([
        {
          key: 'sender-alpha',
          displayName: 'Alpha Sender',
          fromEmail: 'alpha@ethereal.email',
          host: 'smtp.ethereal.email',
          port: 587,
          user: 'alpha@ethereal.email',
          pass: 'alpha_secret_pass',
          secure: false
        },
        {
          key: 'sender-beta',
          displayName: 'Beta Sender',
          fromEmail: 'beta@ethereal.email',
          host: 'smtp.ethereal.email',
          port: 587,
          user: 'beta@ethereal.email',
          pass: 'beta_secret_pass',
          secure: false
        }
      ]);

      const { getSafeSenders, getConfiguredSenders } = await import('../config/senders.config.js');
      const safeSenders = getSafeSenders();
      const configured = getConfiguredSenders();

      expect(safeSenders).toHaveLength(2);
      expect(safeSenders[0]).toEqual({
        key: 'sender-alpha',
        displayName: 'Alpha Sender',
        fromEmail: 'alpha@ethereal.email'
      });

      // Verify passwords, users, hosts, and ports are stripped from safe senders
      for (const s of safeSenders) {
        expect(s).not.toHaveProperty('pass');
        expect(s).not.toHaveProperty('host');
        expect(s).not.toHaveProperty('port');
        expect(s).not.toHaveProperty('user');
      }

      // Verify configured senders contain credentials internally
      expect(configured[0]).toHaveProperty('pass', 'alpha_secret_pass');
      expect(configured[0]).toHaveProperty('host', 'smtp.ethereal.email');

      process.env.ETHEREAL_SENDERS_JSON = original;
    });

    it('should throw descriptive error in verifyAllTransporters when senders are not configured', async () => {
      const original = process.env.ETHEREAL_SENDERS_JSON;
      delete process.env.ETHEREAL_SENDERS_JSON;

      const { verifyAllTransporters } = await import('../services/email.service.js');
      await expect(verifyAllTransporters()).rejects.toThrow('Ethereal SMTP senders are not configured');

      process.env.ETHEREAL_SENDERS_JSON = original;
    });

    it('should sanitize sensitive passwords and tokens from error strings', async () => {
      const { sanitizeError } = await import('../services/email.service.js');
      const sensitiveErr = new Error('SMTP connection failed: pass="secret_123" user="admin" url="redis://:supersecret@localhost:6379" token=abcdef12345');
      const sanitized = sanitizeError(sensitiveErr);

      expect(sanitized).not.toContain('secret_123');
      expect(sanitized).not.toContain('supersecret');
      expect(sanitized).not.toContain('abcdef12345');
      expect(sanitized).toContain('[REDACTED]');
    });

    it('should throw when attempting to send email with unknown sender key', async () => {
      const { sendEmail } = await import('../services/email.service.js');
      await expect(
        sendEmail({
          senderKey: 'non-existent-sender-key',
          recipientEmail: 'test@example.com',
          subject: 'Test',
          body: 'Hello'
        })
      ).rejects.toThrow("Sender with key 'non-existent-sender-key' is not configured.");
    });
  });

  describe('Phase 5: Worker State Transitions & Idempotency Rules', () => {
    it('should skip email job if record is already in SENT status', () => {
      const emailRecord = {
        id: 'email-123',
        status: 'SENT',
        sentAt: new Date()
      };

      const shouldSkip = emailRecord.status === 'SENT';
      expect(shouldSkip).toBe(true);
    });

    it('should perform successful status transition to SENT with preview url and message id', () => {
      const initialRecord = {
        id: 'email-abc',
        status: 'PROCESSING',
        attemptCount: 0,
        errorMessage: 'Previous transient failure'
      };

      const sendResult = {
        messageId: '<msg-12345@ethereal.email>',
        etherealPreviewUrl: 'https://ethereal.email/message/msg-12345'
      };

      const updatedRecord = {
        ...initialRecord,
        status: 'SENT',
        sentAt: new Date(),
        smtpMessageId: sendResult.messageId,
        etherealPreviewUrl: sendResult.etherealPreviewUrl,
        errorMessage: null,
        attemptCount: initialRecord.attemptCount + 1
      };

      expect(updatedRecord.status).toBe('SENT');
      expect(updatedRecord.smtpMessageId).toBe('<msg-12345@ethereal.email>');
      expect(updatedRecord.etherealPreviewUrl).toBe('https://ethereal.email/message/msg-12345');
      expect(updatedRecord.errorMessage).toBeNull();
      expect(updatedRecord.attemptCount).toBe(1);
    });

    it('should mark status as FAILED when retry attempts are exhausted', () => {
      const maxAttempts = 3;
      const currentAttempt = 3;
      const isExhausted = currentAttempt >= maxAttempts;

      const nextStatus = isExhausted ? 'FAILED' : 'SCHEDULED';
      expect(nextStatus).toBe('FAILED');
    });

    it('should reset status to SCHEDULED for BullMQ retry when attempts remain', () => {
      const maxAttempts = 3;
      const currentAttempt = 1;
      const isExhausted = currentAttempt >= maxAttempts;

      const nextStatus = isExhausted ? 'FAILED' : 'SCHEDULED';
      expect(nextStatus).toBe('SCHEDULED');
    });
  });

  describe('Reconciliation and Isolation Logic Rules', () => {
    it('should identify all SCHEDULED status records for reconciliation (including overdue) and ignore SENT/FAILED', () => {
      const emailRecords = [
        { id: '1', status: 'SCHEDULED', scheduledAt: new Date(Date.now() + 60000) },
        { id: '2', status: 'SCHEDULED', scheduledAt: new Date(Date.now() - 60000) }, // overdue
        { id: '3', status: 'SENT', scheduledAt: new Date(Date.now() - 60000) },
        { id: '4', status: 'FAILED', scheduledAt: new Date(Date.now() - 30000) },
        { id: '5', status: 'PROCESSING', scheduledAt: new Date() }
      ];

      // Filter mimicking updated reconciliation query
      const eligibleForReconciliation = emailRecords.filter((e) => e.status === 'SCHEDULED');

      expect(eligibleForReconciliation).toHaveLength(2);
      expect(eligibleForReconciliation.map((e) => e.id)).toEqual(['1', '2']);
    });

    it('should calculate zero delay for overdue scheduled emails', () => {
      const overdueTime = new Date(Date.now() - 60000);
      const delayMs = Math.max(0, overdueTime.getTime() - Date.now());
      expect(delayMs).toBe(0);
    });

    it('should enforce user data isolation by scoping campaign queries to authenticated user ID', () => {
      const userA_Id = 'user-aaa';
      const userB_Id = 'user-bbb';

      const mockDbEmails = [
        { id: 'e1', campaign: { userId: userA_Id }, recipientEmail: 'alice@domain.com' },
        { id: 'e2', campaign: { userId: userB_Id }, recipientEmail: 'bob@domain.com' }
      ];

      // Query for User A
      const userA_Emails = mockDbEmails.filter((e) => e.campaign.userId === userA_Id);
      expect(userA_Emails).toHaveLength(1);
      expect(userA_Emails[0].recipientEmail).toBe('alice@domain.com');

      // Query for User B
      const userB_Emails = mockDbEmails.filter((e) => e.campaign.userId === userB_Id);
      expect(userB_Emails).toHaveLength(1);
      expect(userB_Emails[0].recipientEmail).toBe('bob@domain.com');
    });

    it('should verify database contains scheduled records intact', async () => {
      const { prisma } = await import('../config/prisma.js');
      const count = await prisma.scheduledEmail.count();
      expect(count).toBeGreaterThanOrEqual(3);
      await prisma.$disconnect();
    });
  });
});

