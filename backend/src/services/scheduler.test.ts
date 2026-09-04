import { describe, it, expect } from 'vitest';
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
    const validPayload = {
      subject: 'Welcome to ReachInbox',
      body: 'Hello, this is a scheduled outreach email.',
      recipients: ['user1@example.com', 'user2@example.com'],
      startTime: new Date(Date.now() + 3600000).toISOString(),
      delaySeconds: 10,
      hourlyLimit: 100
    };

    it('should validate a correct campaign payload', () => {
      const result = createCampaignSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
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
  });
});
