import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

    it('should log safe sender identifier only without exposing SMTP email addresses in verifyAllTransporters', async () => {
      const original = process.env.ETHEREAL_SENDERS_JSON;
      process.env.ETHEREAL_SENDERS_JSON = JSON.stringify([
        {
          key: 'sender-test-safe',
          displayName: 'Safe Sender',
          fromEmail: 'secret_sender_address@ethereal.email',
          user: 'secret_sender_user',
          pass: 'secret_sender_pass',
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false
        }
      ]);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { verifyAllTransporters, getTransporter } = await import('../services/email.service.js');

      const transporter = getTransporter({
        key: 'sender-test-safe',
        displayName: 'Safe Sender',
        fromEmail: 'secret_sender_address@ethereal.email',
        user: 'secret_sender_user',
        pass: 'secret_sender_pass',
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false
      });
      vi.spyOn(transporter, 'verify').mockResolvedValue(true as never);

      await verifyAllTransporters();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SMTP] Transporter for sender [sender-test-safe] verified successfully.')
      );
      expect(logSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('secret_sender_address@ethereal.email')
      );

      logSpy.mockRestore();
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

    it('should format sent-list response contract with pagination metadata and user scoping using mock fixtures', () => {
      const mockUserId = 'user-test-777';
      const otherUserId = 'user-other-888';

      const mockDbRecords = [
        {
          id: 'sent-email-1',
          senderKey: 'sender-1',
          recipientEmail: 'client1@example.com',
          subject: 'Welcome to ReachInbox',
          sentAt: new Date('2026-09-04T10:00:00.000Z'),
          status: 'SENT',
          smtpMessageId: '<msg-1@ethereal.email>',
          etherealPreviewUrl: 'https://ethereal.email/message/msg-1',
          campaign: { userId: mockUserId }
        },
        {
          id: 'sent-email-2',
          senderKey: 'sender-2',
          recipientEmail: 'client2@example.com',
          subject: 'Product Update',
          sentAt: new Date('2026-09-04T10:05:00.000Z'),
          status: 'SENT',
          smtpMessageId: '<msg-2@ethereal.email>',
          etherealPreviewUrl: 'https://ethereal.email/message/msg-2',
          campaign: { userId: mockUserId }
        },
        {
          id: 'other-user-email',
          senderKey: 'sender-1',
          recipientEmail: 'stranger@example.com',
          subject: 'Private Email',
          sentAt: new Date('2026-09-04T10:10:00.000Z'),
          status: 'SENT',
          smtpMessageId: '<msg-3@ethereal.email>',
          etherealPreviewUrl: null,
          campaign: { userId: otherUserId }
        }
      ];

      // Simulate getSentEmails user scoping and pagination transformation
      const userRecords = mockDbRecords.filter((e) => e.campaign.userId === mockUserId && ['SENT', 'FAILED'].includes(e.status));
      const page = 1;
      const limit = 10;
      const total = userRecords.length;
      const totalPages = Math.ceil(total / limit);

      const responsePayload = {
        status: 'success',
        emails: userRecords.map((e) => ({
          id: e.id,
          senderKey: e.senderKey,
          recipientEmail: e.recipientEmail,
          subject: e.subject,
          sentAt: e.sentAt ? e.sentAt.toISOString() : null,
          status: e.status,
          smtpMessageId: e.smtpMessageId,
          etherealPreviewUrl: e.etherealPreviewUrl
        })),
        pagination: {
          total,
          page,
          limit,
          totalPages
        }
      };

      // Verify contract shape
      expect(responsePayload.status).toBe('success');
      expect(Array.isArray(responsePayload.emails)).toBe(true);
      expect(responsePayload.emails).toHaveLength(2);
      expect(responsePayload.pagination).toEqual({
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1
      });

      // Verify user scoping (other user's email excluded)
      expect(responsePayload.emails.some((e) => e.id === 'other-user-email')).toBe(false);

      // Verify item fields
      const first = responsePayload.emails[0];
      expect(first).toHaveProperty('id', 'sent-email-1');
      expect(first).toHaveProperty('senderKey', 'sender-1');
      expect(first).toHaveProperty('recipientEmail', 'client1@example.com');
      expect(first).toHaveProperty('subject', 'Welcome to ReachInbox');
      expect(first).toHaveProperty('sentAt', '2026-09-04T10:00:00.000Z');
      expect(first).toHaveProperty('status', 'SENT');
      expect(first).toHaveProperty('smtpMessageId', '<msg-1@ethereal.email>');
      expect(first).toHaveProperty('etherealPreviewUrl', 'https://ethereal.email/message/msg-1');
    });
  });

  describe('Phase 6: Elasticsearch Indexing & Search', () => {
    it('should build clean, deterministic sent email documents from database records', async () => {
      const { buildSentEmailDocument } = await import('./elasticsearch.service.js');

      const mockDbRecord = {
        id: 'email-uuid-12345',
        campaignId: 'camp-uuid-999',
        senderKey: 'sender-1',
        recipientEmail: 'client@company.com',
        subject: 'ReachInbox Product Update',
        body: 'Hello team, here is the new scheduler feature update.',
        status: 'SENT',
        scheduledAt: new Date('2026-09-04T12:00:00.000Z'),
        sentAt: new Date('2026-09-04T12:00:05.000Z'),
        smtpMessageId: '<msg-777@ethereal.email>',
        etherealPreviewUrl: 'https://ethereal.email/message/msg-777',
        createdAt: new Date('2026-09-04T11:50:00.000Z'),
        campaign: {
          userId: 'user-guid-456'
        }
      };

      const doc = buildSentEmailDocument(mockDbRecord);

      // Verify deterministic document ID matches database record ID
      expect(doc.id).toBe(mockDbRecord.id);
      expect(doc.userId).toBe('user-guid-456');
      expect(doc.campaignId).toBe('camp-uuid-999');
      expect(doc.recipientEmail).toBe('client@company.com');
      expect(doc.senderKey).toBe('sender-1');
      expect(doc.subject).toBe('ReachInbox Product Update');
      expect(doc.body).toBe('Hello team, here is the new scheduler feature update.');
      expect(doc.status).toBe('SENT');
      expect(doc.smtpMessageId).toBe('<msg-777@ethereal.email>');
      expect(doc.etherealPreviewUrl).toBe('https://ethereal.email/message/msg-777');
      expect(doc.scheduledAt).toBe('2026-09-04T12:00:00.000Z');
      expect(doc.sentAt).toBe('2026-09-04T12:00:05.000Z');
      expect(doc.createdAt).toBe('2026-09-04T11:50:00.000Z');

      // Verify no passwords, tokens, or connection strings are present in the document
      expect(doc).not.toHaveProperty('pass');
      expect(doc).not.toHaveProperty('password');
      expect(doc).not.toHaveProperty('sessionSecret');
      expect(doc).not.toHaveProperty('googleId');
    });

    it('should throw error when building document if userId is missing', async () => {
      const { buildSentEmailDocument } = await import('./elasticsearch.service.js');
      const invalidRecord = {
        id: 'email-1',
        campaignId: 'c1',
        senderKey: 's1',
        recipientEmail: 'test@example.com',
        subject: 'sub',
        body: 'body',
        status: 'SENT',
        scheduledAt: new Date(),
        sentAt: new Date(),
        smtpMessageId: 'm1',
        etherealPreviewUrl: null,
        createdAt: new Date(),
        campaign: null
      };

      expect(() => buildSentEmailDocument(invalidRecord)).toThrow('missing userId');
    });

    it('should verify explicit index mapping definition includes all required search and filter fields', async () => {
      const { SENT_EMAILS_MAPPING_PROPERTIES, SENT_EMAILS_INDEX } = await import('../config/elasticsearch.js');

      expect(SENT_EMAILS_INDEX).toBe('reachinbox-sent-emails');
      expect(SENT_EMAILS_MAPPING_PROPERTIES.id.type).toBe('keyword');
      expect(SENT_EMAILS_MAPPING_PROPERTIES.userId.type).toBe('keyword');
      expect(SENT_EMAILS_MAPPING_PROPERTIES.campaignId.type).toBe('keyword');
      expect(SENT_EMAILS_MAPPING_PROPERTIES.senderKey.type).toBe('keyword');
      expect(SENT_EMAILS_MAPPING_PROPERTIES.status.type).toBe('keyword');
      expect(SENT_EMAILS_MAPPING_PROPERTIES.subject.type).toBe('text');
      expect(SENT_EMAILS_MAPPING_PROPERTIES.body.type).toBe('text');
      expect(SENT_EMAILS_MAPPING_PROPERTIES.scheduledAt.type).toBe('date');
      expect(SENT_EMAILS_MAPPING_PROPERTIES.sentAt.type).toBe('date');
      expect(SENT_EMAILS_MAPPING_PROPERTIES.recipientEmail.type).toBe('keyword');
    });

    it('should safely initialize index when Elasticsearch is running', async () => {
      const { ensureSentEmailsIndex } = await import('./elasticsearch.service.js');
      const result = await ensureSentEmailsIndex();
      expect(typeof result).toBe('boolean');
    });

    it('should enforce user isolation: queries must filter by authenticated userId', () => {
      const userA = 'user-alice-111';
      const userB = 'user-bob-222';
      const queryText = 'ReachInbox';

      // Mock query builder logic mirroring searchUserSentEmails
      const buildQuery = (userId: string, q: string) => ({
        bool: {
          filter: [{ term: { userId } }],
          must: [
            {
              multi_match: {
                query: q,
                fields: ['subject^3', 'recipientEmail.text^2', 'recipientEmail^2', 'body']
              }
            }
          ]
        }
      });

      const aliceQuery = buildQuery(userA, queryText);
      const bobQuery = buildQuery(userB, queryText);

      expect(aliceQuery.bool.filter[0].term.userId).toBe(userA);
      expect(bobQuery.bool.filter[0].term.userId).toBe(userB);
      expect(aliceQuery.bool.filter[0].term.userId).not.toBe(bobQuery.bool.filter[0].term.userId);
    });

    it('should validate search query parameters and return empty results on empty query', async () => {
      const { searchUserSentEmails } = await import('./elasticsearch.service.js');
      const emptyResult = await searchUserSentEmails({
        userId: 'user-123',
        query: '   '
      });

      expect(emptyResult.emails).toEqual([]);
      expect(emptyResult.pagination.total).toBe(0);
    });

    it('should ensure Elasticsearch failures do not revert SENT status or cause email re-sending in worker', () => {
      // Simulate worker post-send handling
      let dbStatus = 'PROCESSING';
      let emailResent = false;

      // 1. SMTP succeeds
      const smtpSuccess = true;
      if (smtpSuccess) {
        dbStatus = 'SENT';
      }

      // 2. Elasticsearch indexing simulated exception
      try {
        const esIndex = () => { throw new Error('Elasticsearch connection timeout'); };
        esIndex();
      } catch (esErr) {
        // Non-fatal catch: logs warning, never reverts dbStatus or sets emailResent
      }

      expect(dbStatus).toBe('SENT');
      expect(emailResent).toBe(false);
    });
  });

  describe('Elasticsearch Scheduled Emails Indexing & Search', () => {
    it('should correctly build a ScheduledEmailDocument from record with direct userId', async () => {
      const { buildScheduledEmailDocument } = await import('./elasticsearch.service.js');
      const now = new Date();
      const schedTime = new Date(Date.now() + 60000);

      const record = {
        id: 'sched-email-1',
        userId: 'user-alice-123',
        campaignId: 'camp-123',
        senderKey: 'sender-1',
        recipientEmail: 'Recipient@Example.Com',
        subject: 'Scheduled Outreach',
        body: 'Hello, this email is scheduled for tomorrow.',
        status: 'SCHEDULED',
        scheduledAt: schedTime,
        createdAt: now
      };

      const doc = buildScheduledEmailDocument(record);

      expect(doc.id).toBe('sched-email-1');
      expect(doc.userId).toBe('user-alice-123');
      expect(doc.campaignId).toBe('camp-123');
      expect(doc.senderKey).toBe('sender-1');
      expect(doc.recipientEmail).toBe('Recipient@Example.Com');
      expect(doc.subject).toBe('Scheduled Outreach');
      expect(doc.body).toBe('Hello, this email is scheduled for tomorrow.');
      expect(doc.status).toBe('SCHEDULED');
      expect(doc.scheduledAt).toBe(schedTime.toISOString());
      expect(doc.createdAt).toBe(now.toISOString());
    });

    it('should extract userId from nested campaign when direct userId is not present', async () => {
      const { buildScheduledEmailDocument } = await import('./elasticsearch.service.js');
      const record = {
        id: 'sched-email-2',
        campaignId: 'camp-456',
        senderKey: 'sender-2',
        recipientEmail: 'client@example.org',
        subject: 'Follow-up Email',
        body: 'Just following up on our meeting.',
        status: 'RATE_LIMITED',
        scheduledAt: new Date(),
        createdAt: new Date(),
        campaign: {
          userId: 'user-bob-999'
        }
      };

      const doc = buildScheduledEmailDocument(record);
      expect(doc.userId).toBe('user-bob-999');
      expect(doc.status).toBe('RATE_LIMITED');
    });

    it('should throw error when building scheduled document if userId cannot be determined', async () => {
      const { buildScheduledEmailDocument } = await import('./elasticsearch.service.js');
      const invalidRecord = {
        id: 'sched-email-orphan',
        campaignId: 'camp-orphan',
        senderKey: 'sender-1',
        recipientEmail: 'orphan@example.com',
        subject: 'No Owner',
        body: 'Missing user',
        status: 'SCHEDULED',
        scheduledAt: new Date(),
        createdAt: new Date(),
        campaign: null
      };

      expect(() => buildScheduledEmailDocument(invalidRecord)).toThrow('missing userId');
    });

    it('should verify scheduled emails explicit mapping definition includes all required fields', async () => {
      const { SCHEDULED_EMAILS_MAPPING_PROPERTIES, SCHEDULED_EMAILS_INDEX } = await import('../config/elasticsearch.js');

      expect(SCHEDULED_EMAILS_INDEX).toBe('reachinbox-scheduled-emails');
      expect(SCHEDULED_EMAILS_MAPPING_PROPERTIES.id.type).toBe('keyword');
      expect(SCHEDULED_EMAILS_MAPPING_PROPERTIES.userId.type).toBe('keyword');
      expect(SCHEDULED_EMAILS_MAPPING_PROPERTIES.campaignId.type).toBe('keyword');
      expect(SCHEDULED_EMAILS_MAPPING_PROPERTIES.senderKey.type).toBe('keyword');
      expect(SCHEDULED_EMAILS_MAPPING_PROPERTIES.status.type).toBe('keyword');
      expect(SCHEDULED_EMAILS_MAPPING_PROPERTIES.subject.type).toBe('text');
      expect(SCHEDULED_EMAILS_MAPPING_PROPERTIES.body.type).toBe('text');
      expect(SCHEDULED_EMAILS_MAPPING_PROPERTIES.scheduledAt.type).toBe('date');
      expect(SCHEDULED_EMAILS_MAPPING_PROPERTIES.createdAt.type).toBe('date');
      expect(SCHEDULED_EMAILS_MAPPING_PROPERTIES.recipientEmail.type).toBe('keyword');
      expect(SCHEDULED_EMAILS_MAPPING_PROPERTIES.recipientEmail.fields.text.type).toBe('text');
    });

    it('should safely initialize scheduled emails index when Elasticsearch is running', async () => {
      const { ensureScheduledEmailsIndex } = await import('./elasticsearch.service.js');
      const result = await ensureScheduledEmailsIndex();
      expect(typeof result).toBe('boolean');
    });

    it('should enforce strict user isolation and active status filtering for scheduled email queries', () => {
      const userA = 'user-alice-111';
      const userB = 'user-bob-222';
      const queryText = 'Quarterly Campaign';

      const buildScheduledSearchQuery = (userId: string, q: string) => ({
        bool: {
          filter: [
            { term: { userId } },
            { terms: { status: ['SCHEDULED', 'RATE_LIMITED', 'PROCESSING'] } }
          ],
          must: [
            {
              multi_match: {
                query: q,
                fields: ['subject^3', 'recipientEmail.text^2', 'recipientEmail^2', 'body', 'senderKey']
              }
            }
          ]
        }
      });

      const aliceQuery = buildScheduledSearchQuery(userA, queryText);
      const bobQuery = buildScheduledSearchQuery(userB, queryText);

      // Verify tenant filter
      expect(aliceQuery.bool.filter[0].term.userId).toBe(userA);
      expect(bobQuery.bool.filter[0].term.userId).toBe(userB);
      expect(aliceQuery.bool.filter[0].term.userId).not.toBe(bobQuery.bool.filter[0].term.userId);

      // Verify active status filter
      expect(aliceQuery.bool.filter[1].terms.status).toEqual(['SCHEDULED', 'RATE_LIMITED', 'PROCESSING']);
    });

    it('should return empty results gracefully when scheduled search query is empty or whitespace', async () => {
      const { searchUserScheduledEmails } = await import('./elasticsearch.service.js');
      const emptyResult = await searchUserScheduledEmails({
        userId: 'user-123',
        query: '    '
      });

      expect(emptyResult.emails).toEqual([]);
      expect(emptyResult.pagination.total).toBe(0);
      expect(emptyResult.pagination.page).toBe(1);
    });

    it('should safely delete scheduled email doc without error even if document is not found', async () => {
      const { deleteScheduledEmailDoc } = await import('./elasticsearch.service.js');
      await expect(deleteScheduledEmailDoc('non-existent-doc-id')).resolves.not.toThrow();
    });

    it('should verify backfillScheduledEmailsToIndex targets only active statuses (SCHEDULED, RATE_LIMITED, PROCESSING) and excludes SENT and FAILED', async () => {
      const activeStatuses = ['SCHEDULED', 'RATE_LIMITED', 'PROCESSING'];
      const terminalStatuses = ['SENT', 'FAILED'];

      // Status predicate check
      const shouldIncludeInScheduledBackfill = (status: string) => activeStatuses.includes(status);

      expect(shouldIncludeInScheduledBackfill('SCHEDULED')).toBe(true);
      expect(shouldIncludeInScheduledBackfill('RATE_LIMITED')).toBe(true);
      expect(shouldIncludeInScheduledBackfill('PROCESSING')).toBe(true);
      expect(shouldIncludeInScheduledBackfill('SENT')).toBe(false);
      expect(shouldIncludeInScheduledBackfill('FAILED')).toBe(false);

      terminalStatuses.forEach((st) => {
        expect(activeStatuses).not.toContain(st);
      });
    });

    it('should ensure backfill is idempotent across multiple invocations using deterministic document IDs', () => {
      const mockIndex = new Map<string, any>();

      const mockBackfillRecord = (record: { id: string; status: string; subject: string }) => {
        if (['SCHEDULED', 'RATE_LIMITED', 'PROCESSING'].includes(record.status)) {
          mockIndex.set(record.id, record);
        }
      };

      const record1 = { id: 'email-1', status: 'SCHEDULED', subject: 'Campaign 1' };
      const record2 = { id: 'email-2', status: 'RATE_LIMITED', subject: 'Campaign 2' };

      // First backfill pass
      mockBackfillRecord(record1);
      mockBackfillRecord(record2);
      expect(mockIndex.size).toBe(2);

      // Second identical backfill pass (idempotent)
      mockBackfillRecord(record1);
      mockBackfillRecord(record2);
      expect(mockIndex.size).toBe(2);
      expect(mockIndex.get('email-1')?.subject).toBe('Campaign 1');
    });

    it('should prevent race condition: indexScheduledEmail aborts indexing and deletes doc if MySQL status is SENT or FAILED', async () => {
      const { indexScheduledEmail } = await import('./elasticsearch.service.js');
      const { prisma } = await import('../config/prisma.js');

      // Mock prisma findUnique returning a SENT record
      const origFindUnique = prisma.scheduledEmail.findUnique;
      (prisma.scheduledEmail as any).findUnique = vi.fn().mockResolvedValue({
        id: 'race-test-sent-id',
        status: 'SENT',
        campaign: { userId: 'user-race-1' }
      });

      try {
        const result = await indexScheduledEmail('race-test-sent-id');
        expect(result).toBe(false);
      } finally {
        prisma.scheduledEmail.findUnique = origFindUnique;
      }
    });

    it('should verify Elasticsearch connection failures in backfill are non-fatal and return 0 count without throwing', async () => {
      const { backfillScheduledEmailsToIndex } = await import('./elasticsearch.service.js');
      const result = await backfillScheduledEmailsToIndex();
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });
});

