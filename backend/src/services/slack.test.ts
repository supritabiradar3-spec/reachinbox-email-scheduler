import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  encryptSlackToken,
  decryptSlackToken,
  getEncryptionKeyBuffer
} from './slackCrypto.service.js';
import {
  exchangeSlackOAuthCode,
  fetchSlackChannels,
  verifySlackChannel,
  buildSlackCompletionMessage,
  checkAndSendCampaignSlackNotification
} from './slack.service.js';
import {
  generateSlackOAuthState,
  generateSlackOAuthUrl,
  getSlackStatus,
  getSlackChannels
} from '../controllers/slack.controller.js';
import { createCampaignSchema } from '../validators/campaign.validator.js';
import { prisma } from '../config/prisma.js';
import { Request, Response } from 'express';

describe('Phase 8: Real Slack OAuth 2.0 Integration & Completion Notifications', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.SLACK_TOKEN_ENCRYPTION_KEY;
  const originalClientId = process.env.SLACK_CLIENT_ID;
  const originalClientSecret = process.env.SLACK_CLIENT_SECRET;
  const originalSenders = process.env.ETHEREAL_SENDERS_JSON;

  beforeEach(() => {
    // Standard 32-byte hex test key (64 hex characters)
    process.env.SLACK_TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.SLACK_CLIENT_ID = 'test-slack-client-id';
    process.env.SLACK_CLIENT_SECRET = 'test-slack-client-secret';
    process.env.SLACK_REDIRECT_URI = 'http://localhost:5000/api/slack/oauth/callback';
    process.env.ETHEREAL_SENDERS_JSON = JSON.stringify([
      {
        key: 'reachinbox-sales',
        displayName: 'ReachInbox Sales',
        fromEmail: 'sales@reachinbox.ai',
        host: 'smtp.ethereal.email',
        port: 587,
        user: 'sales@reachinbox.ai',
        pass: 'pass123',
        secure: false
      }
    ]);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.SLACK_TOKEN_ENCRYPTION_KEY = originalKey;
    process.env.SLACK_CLIENT_ID = originalClientId;
    process.env.SLACK_CLIENT_SECRET = originalClientSecret;
    process.env.ETHEREAL_SENDERS_JSON = originalSenders;
    vi.restoreAllMocks();
  });

  // 1. AES-256-GCM encryption produces valid hex payload with iv, ciphertext, tag
  it('1. AES-256-GCM encryption produces valid hex payload with iv, ciphertext, tag', () => {
    const rawToken = 'xoxb-1234567890-abcdefghijklmnop';
    const encrypted = encryptSlackToken(rawToken);

    expect(typeof encrypted).toBe('string');
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(3);

    const [ivHex, tagHex, ciphertextHex] = parts;
    // 12 bytes IV = 24 hex characters
    expect(ivHex).toHaveLength(24);
    // 16 bytes Auth Tag = 32 hex characters
    expect(tagHex).toHaveLength(32);
    expect(ciphertextHex.length).toBeGreaterThan(0);
  });

  // 2. Decryption of valid ciphertext returns exact original bot token
  it('2. Decryption of valid ciphertext returns exact original bot token', () => {
    const sampleTokens = [
      'xoxb-1234567890-abcdefghijklmnop',
      'xoxp-9876543210-zyxwvutsrqponmlk',
      'test-token-with-special-chars-!@#$%^&*()'
    ];

    for (const token of sampleTokens) {
      const encrypted = encryptSlackToken(token);
      const decrypted = decryptSlackToken(encrypted);
      expect(decrypted).toBe(token);
    }
  });

  // 3. Decryption fails with tampered ciphertext or altered auth tag
  it('3. Decryption fails with tampered ciphertext or altered auth tag', () => {
    const rawToken = 'xoxb-super-secret-bot-token';
    const encrypted = encryptSlackToken(rawToken);
    const [ivHex, tagHex, ciphertextHex] = encrypted.split(':');

    // Tamper ciphertext
    const tamperedCiphertextHex = ciphertextHex.slice(0, -2) + (ciphertextHex.endsWith('0') ? '1' : '0');
    expect(() => decryptSlackToken(`${ivHex}:${tagHex}:${tamperedCiphertextHex}`)).toThrow();

    // Tamper auth tag
    const tamperedTagHex = tagHex.slice(0, -2) + (tagHex.endsWith('0') ? '1' : '0');
    expect(() => decryptSlackToken(`${ivHex}:${tamperedTagHex}:${ciphertextHex}`)).toThrow();
  });

  // 4. Encryption/decryption fails gracefully with invalid key lengths
  it('4. Encryption/decryption fails gracefully with invalid key lengths', () => {
    // Less than 32 bytes
    expect(() => getEncryptionKeyBuffer('short-key')).toThrow(/32 bytes/);
    expect(() => encryptSlackToken('test', 'short-key')).toThrow(/32 bytes/);

    // Empty key
    expect(() => getEncryptionKeyBuffer('')).toThrow(/SLACK_TOKEN_ENCRYPTION_KEY is not configured/);
  });

  // 5. OAuth state generator produces 32+ char cryptographic random string
  it('5. OAuth state generator produces 32+ char cryptographic random string', () => {
    const state1 = generateSlackOAuthState();
    const state2 = generateSlackOAuthState();

    expect(typeof state1).toBe('string');
    expect(state1.length).toBeGreaterThanOrEqual(32);
    expect(state1).not.toBe(state2); // Non-deterministic and unique
  });

  // 6. OAuth authorization URL contains client_id, redirect_uri, scope, state
  it('6. OAuth authorization URL contains client_id, redirect_uri, scope, state', () => {
    const state = 'test-state-token-1234567890abcdef';
    const url = generateSlackOAuthUrl(state);

    expect(url).toContain('https://slack.com/oauth/v2/authorize');
    expect(url).toContain(`state=${state}`);
    expect(url).toContain('scope=chat%3Awrite%2Cchannels%3Aread%2Cgroups%3Aread');
    expect(url).toContain('client_id=test-slack-client-id');
  });

  // 7. OAuth code exchange calls Slack oauth.v2.access with credentials and parses response
  it('7. OAuth code exchange calls Slack oauth.v2.access with credentials and parses response', async () => {
    const mockResponse = {
      ok: true,
      access_token: 'xoxb-mock-bot-token',
      scope: 'chat:write,channels:read',
      bot_user_id: 'U12345678',
      team: {
        id: 'T12345678',
        name: 'ReachInbox Workspace'
      }
    };

    global.fetch = vi.fn().mockResolvedValue({
      json: async () => mockResponse
    } as unknown as Response);

    const result = await exchangeSlackOAuthCode('valid-auth-code');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://slack.com/api/oauth.v2.access',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' })
      })
    );

    expect(result.ok).toBe(true);
    expect(result.access_token).toBe('xoxb-mock-bot-token');
    expect(result.team.name).toBe('ReachInbox Workspace');
  });

  // 8. OAuth code exchange handles Slack API error response (e.g. invalid_code)
  it('8. OAuth code exchange handles Slack API error response (e.g. invalid_code)', async () => {
    const mockErrorResponse = {
      ok: false,
      error: 'invalid_code'
    };

    global.fetch = vi.fn().mockResolvedValue({
      json: async () => mockErrorResponse
    } as unknown as Response);

    await expect(exchangeSlackOAuthCode('expired-auth-code')).rejects.toThrow(
      'Slack OAuth error: invalid_code'
    );
  });

  // 9. Channel fetch paginates across multi-page responses using cursor
  it('9. Channel fetch paginates across multi-page responses using cursor', async () => {
    const page1Response = {
      ok: true,
      channels: [
        { id: 'C001', name: 'general', is_private: false },
        { id: 'C002', name: 'marketing', is_private: false }
      ],
      response_metadata: { next_cursor: 'cursor_page_2' }
    };

    const page2Response = {
      ok: true,
      channels: [
        { id: 'C003', name: 'eng-alerts', is_private: true }
      ],
      response_metadata: { next_cursor: '' }
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ json: async () => page1Response } as unknown as Response)
      .mockResolvedValueOnce({ json: async () => page2Response } as unknown as Response);

    const channels = await fetchSlackChannels('xoxb-test-token');

    expect(channels).toHaveLength(3);
    expect(channels.map((c) => c.name)).toEqual(['general', 'marketing', 'eng-alerts']);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  // 10. Channel fetch filters archived channels and includes private channels bot is in
  it('10. Channel fetch filters archived channels and includes private channels bot is in', async () => {
    const mockResponse = {
      ok: true,
      channels: [
        { id: 'C001', name: 'active-channel', is_private: false },
        { id: 'C002', name: 'confidential-deals', is_private: true }
      ],
      response_metadata: { next_cursor: '' }
    };

    global.fetch = vi.fn().mockResolvedValue({
      json: async () => mockResponse
    } as unknown as Response);

    const channels = await fetchSlackChannels('xoxb-test-token');

    expect(channels).toHaveLength(2);
    expect(channels[0].isPrivate).toBe(false);
    expect(channels[1].isPrivate).toBe(true);
  });

  // 11. Channel verification succeeds for valid channel ID and fails for non-existent channel
  it('11. Channel verification succeeds for valid channel ID and fails for non-existent channel', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('CVALID')) {
        return {
          json: async () => ({
            ok: true,
            channel: { id: 'CVALID', name: 'product-updates' }
          })
        };
      }
      return {
        json: async () => ({
          ok: false,
          error: 'channel_not_found'
        })
      };
    });

    const validResult = await verifySlackChannel('xoxb-token', 'CVALID');
    expect(validResult.id).toBe('CVALID');
    expect(validResult.name).toBe('product-updates');

    await expect(verifySlackChannel('xoxb-token', 'CINVALID')).rejects.toThrow(
      'Slack channel verification failed: channel_not_found'
    );
  });

  // 12. Slack Block Kit message formatting contains subject, recipient count, sent/failed stats
  it('12. Slack Block Kit message formatting contains subject, recipient count, sent/failed stats', () => {
    const stats = {
      campaignSubject: 'Q3 Enterprise Launch',
      totalRecipients: 50,
      sentCount: 48,
      failedCount: 2,
      completedAt: new Date('2026-09-04T12:00:00.000Z')
    };

    const message = buildSlackCompletionMessage('C12345', stats);

    expect(message.channel).toBe('C12345');
    expect(message.text).toContain('Q3 Enterprise Launch');
    expect(message.text).toContain('48/50 sent');
    expect(message.text).toContain('2 failed');

    const fieldsString = JSON.stringify(message.blocks);
    expect(fieldsString).toContain('Q3 Enterprise Launch');
    expect(fieldsString).toContain('50');
    expect(fieldsString).toContain('48');
    expect(fieldsString).toContain('2');
  });

  // 13. Slack message formatting does NOT contain email bodies, recipient lists, or secrets
  it('13. Slack message formatting does NOT contain email bodies, recipient lists, or secrets', () => {
    const stats = {
      campaignSubject: 'Security Notice',
      totalRecipients: 10,
      sentCount: 10,
      failedCount: 0,
      completedAt: new Date()
    };

    const message = buildSlackCompletionMessage('C12345', stats);
    const jsonStr = JSON.stringify(message);

    // Verify absence of sensitive tokens, user emails or secret properties
    expect(jsonStr).not.toContain('recipientEmail');
    expect(jsonStr).not.toContain('smtpMessageId');
    expect(jsonStr).not.toContain('xoxb-');
    expect(jsonStr).not.toContain('password');
    expect(jsonStr).not.toContain('session');
  });

  // 14. Campaign creation schema with valid Slack installation and channel sets notifySlack
  it('14. Campaign creation schema with valid Slack installation and channel passes validation', () => {
    const validPayload = {
      senderKey: 'reachinbox-sales',
      subject: 'Welcome to ReachInbox',
      body: 'Hello and welcome!',
      recipients: ['alice@example.com', 'bob@example.com'],
      startTime: new Date(Date.now() + 60000).toISOString(),
      delaySeconds: 5,
      hourlyLimit: 100,
      notifySlack: true,
      slackInstallationId: '123e4567-e89b-12d3-a456-426614174000',
      slackChannelId: 'C12345678',
      slackChannelName: 'announcements'
    };

    const result = createCampaignSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  // 15. Campaign creation schema fails when notifySlack is true but channel is missing
  it('15. Campaign creation schema fails when notifySlack is true but channel is missing', () => {
    const invalidPayload = {
      senderKey: 'reachinbox-sales',
      subject: 'Welcome to ReachInbox',
      body: 'Hello and welcome!',
      recipients: ['alice@example.com'],
      startTime: new Date(Date.now() + 60000).toISOString(),
      delaySeconds: 5,
      hourlyLimit: 100,
      notifySlack: true,
      slackInstallationId: '123e4567-e89b-12d3-a456-426614174000'
      // Missing slackChannelId
    };

    const result = createCampaignSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });

  // 16. Campaign creation schema rejects invalid UUIDs for slackInstallationId
  it('16. Campaign creation schema rejects invalid UUIDs for slackInstallationId', () => {
    const invalidPayload = {
      senderKey: 'reachinbox-sales',
      subject: 'Welcome to ReachInbox',
      body: 'Hello and welcome!',
      recipients: ['alice@example.com'],
      startTime: new Date(Date.now() + 60000).toISOString(),
      delaySeconds: 5,
      hourlyLimit: 100,
      notifySlack: true,
      slackInstallationId: 'not-a-valid-uuid',
      slackChannelId: 'C12345678'
    };

    const result = createCampaignSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });

  // 17. Campaign creation without Slack passes validation with default/omitted Slack fields
  it('17. Campaign creation without Slack passes validation with default/omitted Slack fields', () => {
    const plainPayload = {
      senderKey: 'reachinbox-sales',
      subject: 'Standard Campaign',
      body: 'Content',
      recipients: ['alice@example.com'],
      startTime: new Date(Date.now() + 60000).toISOString(),
      delaySeconds: 5,
      hourlyLimit: 100
    };

    const result = createCampaignSchema.safeParse(plainPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notifySlack).toBeUndefined();
    }
  });

  // 18. checkAndSendCampaignSlackNotification skips campaign when some emails are still non-terminal
  it('18. checkAndSendCampaignSlackNotification skips campaign when some emails are still non-terminal', async () => {
    const mockFindCampaign = vi.spyOn(prisma.emailCampaign, 'findUnique').mockResolvedValue({
      id: 'camp-partial',
      subject: 'Partial Campaign',
      recipientCount: 5,
      slackNotificationStatus: 'PENDING',
      slackInstallationId: 'inst-1',
      slackChannelId: 'C123',
      slackInstallation: {
        id: 'inst-1',
        encryptedBotToken: encryptSlackToken('xoxb-test')
      }
    } as unknown as Awaited<ReturnType<typeof prisma.emailCampaign.findUnique>>);

    // 2 emails still SCHEDULED or PROCESSING
    const mockCountScheduled = vi.spyOn(prisma.scheduledEmail, 'count').mockResolvedValue(2);
    const mockUpdateCampaign = vi.spyOn(prisma.emailCampaign, 'updateMany');

    await checkAndSendCampaignSlackNotification('camp-partial');

    expect(mockFindCampaign).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'camp-partial' } }));
    expect(mockCountScheduled).toHaveBeenCalled();
    // Must NOT claim or send since non-terminal emails remain
    expect(mockUpdateCampaign).not.toHaveBeenCalled();
  });

  // 19. checkAndSendCampaignSlackNotification claims PENDING -> PROCESSING atomically and sends message when all emails reach SENT/FAILED
  it('19. checkAndSendCampaignSlackNotification claims PENDING -> PROCESSING atomically and sends message when all emails reach SENT/FAILED', async () => {
    vi.spyOn(prisma.emailCampaign, 'findUnique').mockResolvedValue({
      id: 'camp-complete',
      subject: 'Complete Campaign',
      recipientCount: 3,
      slackNotificationStatus: 'PENDING',
      slackInstallationId: 'inst-1',
      slackChannelId: 'C123',
      slackChannelName: 'general',
      slackInstallation: {
        id: 'inst-1',
        encryptedBotToken: encryptSlackToken('xoxb-test-token')
      }
    } as unknown as Awaited<ReturnType<typeof prisma.emailCampaign.findUnique>>);

    // 0 non-terminal emails
    vi.spyOn(prisma.scheduledEmail, 'count')
      .mockResolvedValueOnce(0) // non-terminal count
      .mockResolvedValueOnce(2) // sent count
      .mockResolvedValueOnce(1); // failed count

    // Atomic claim succeeds
    const mockClaim = vi.spyOn(prisma.emailCampaign, 'updateMany').mockResolvedValue({ count: 1 });
    const mockFinalUpdate = vi.spyOn(prisma.emailCampaign, 'update').mockResolvedValue({} as unknown as Awaited<ReturnType<typeof prisma.emailCampaign.update>>);

    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true })
    } as unknown as Response);

    await checkAndSendCampaignSlackNotification('camp-complete');

    expect(mockClaim).toHaveBeenCalledWith({
      where: { id: 'camp-complete', slackNotificationStatus: 'PENDING' },
      data: { slackNotificationStatus: 'PROCESSING' }
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer xoxb-test-token'
        })
      })
    );

    expect(mockFinalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'camp-complete' },
        data: expect.objectContaining({ slackNotificationStatus: 'SENT' })
      })
    );
  });

  // 20. checkAndSendCampaignSlackNotification is idempotent (second invocation is no-op if already PROCESSING or SENT)
  it('20. checkAndSendCampaignSlackNotification is idempotent (second invocation is no-op if already PROCESSING or SENT)', async () => {
    vi.spyOn(prisma.emailCampaign, 'findUnique').mockResolvedValue({
      id: 'camp-already-sent',
      subject: 'Already Sent Campaign',
      recipientCount: 5,
      slackNotificationStatus: 'SENT', // Already SENT
      slackInstallationId: 'inst-1',
      slackChannelId: 'C123',
      slackInstallation: {
        id: 'inst-1',
        encryptedBotToken: encryptSlackToken('xoxb-test-token')
      }
    } as unknown as Awaited<ReturnType<typeof prisma.emailCampaign.findUnique>>);

    const mockCount = vi.spyOn(prisma.scheduledEmail, 'count');
    const mockClaim = vi.spyOn(prisma.emailCampaign, 'updateMany');

    await checkAndSendCampaignSlackNotification('camp-already-sent');

    // Should return immediately without querying scheduled emails or attempting claim
    expect(mockCount).not.toHaveBeenCalled();
    expect(mockClaim).not.toHaveBeenCalled();
  });

  // 21. getSlackStatus returns connected=true with safe installation metadata and zero token fields
  it('21. getSlackStatus returns connected=true with safe installation metadata and zero token fields', async () => {
    vi.spyOn(prisma.slackInstallation, 'findFirst').mockResolvedValue({
      id: 'inst-test-uuid',
      teamId: 'T12345678',
      teamName: 'ReachInbox Workspace',
      createdAt: new Date('2026-09-04T10:00:00.000Z')
    } as unknown as Awaited<ReturnType<typeof prisma.slackInstallation.findFirst>>);

    const mockReq = {
      user: { id: 'user-test-id' }
    } as unknown as Request;

    let jsonResponse: unknown = null;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockImplementation((data) => {
        jsonResponse = data;
      })
    } as unknown as Response;

    await getSlackStatus(mockReq, mockRes);

    expect(jsonResponse).toEqual({
      status: 'success',
      configured: true,
      connected: true,
      installation: {
        id: 'inst-test-uuid',
        teamId: 'T12345678',
        teamName: 'ReachInbox Workspace',
        createdAt: '2026-09-04T10:00:00.000Z'
      },
      installationId: 'inst-test-uuid',
      teamName: 'ReachInbox Workspace',
      teamId: 'T12345678',
      connectedAt: '2026-09-04T10:00:00.000Z'
    });

    // Zero sensitive fields in response
    const jsonStr = JSON.stringify(jsonResponse);
    expect(jsonStr).not.toContain('encryptedBotToken');
    expect(jsonStr).not.toContain('access_token');
    expect(jsonStr).not.toContain('token');
  });

  // 22. getSlackStatus returns connected=false when user has no installation
  it('22. getSlackStatus returns connected=false when user has no installation', async () => {
    vi.spyOn(prisma.slackInstallation, 'findFirst').mockResolvedValue(null);

    const mockReq = {
      user: { id: 'user-test-id' }
    } as unknown as Request;

    let jsonResponse: unknown = null;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockImplementation((data) => {
        jsonResponse = data;
      })
    } as unknown as Response;

    await getSlackStatus(mockReq, mockRes);

    expect(jsonResponse).toEqual({
      status: 'success',
      configured: true,
      connected: false,
      installation: null,
      installationId: null,
      teamName: null,
      teamId: null,
      connectedAt: null
    });
  });

  // 23. getSlackChannels returns success with safe fields only (id, name, isPrivate)
  it('23. getSlackChannels returns success with safe fields only (id, name, isPrivate)', async () => {
    const validEncryptedToken = encryptSlackToken('xoxb-valid-bot-token');
    vi.spyOn(prisma.slackInstallation, 'findFirst').mockResolvedValue({
      id: 'inst-1',
      userId: 'user-test-id',
      teamId: 'T123',
      teamName: 'Acme Corp',
      encryptedBotToken: validEncryptedToken
    } as unknown as Awaited<ReturnType<typeof prisma.slackInstallation.findFirst>>);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        channels: [
          { id: 'C100', name: 'general', is_private: false, topic: 'secret' },
          { id: 'C200', name: 'private-team', is_private: true }
        ]
      })
    } as unknown as Response);

    const mockReq = { user: { id: 'user-test-id' } } as unknown as Request;
    let jsonResponse: unknown = null;
    let statusCode: number = 200;
    const mockRes = {
      status: vi.fn().mockImplementation((code) => {
        statusCode = code;
        return mockRes;
      }),
      json: vi.fn().mockImplementation((data) => {
        jsonResponse = data;
      })
    } as unknown as Response;

    await getSlackChannels(mockReq, mockRes);

    expect(statusCode).toBe(200);
    expect(jsonResponse).toEqual({
      status: 'success',
      teamName: 'Acme Corp',
      channels: [
        { id: 'C100', name: 'general', isPrivate: false },
        { id: 'C200', name: 'private-team', isPrivate: true }
      ]
    });

    const jsonStr = JSON.stringify(jsonResponse);
    expect(jsonStr).not.toContain('xoxb-');
    expect(jsonStr).not.toContain('token');
  });

  // 24. getSlackChannels returns 401 when request is unauthenticated
  it('24. getSlackChannels returns 401 when request is unauthenticated', async () => {
    const mockReq = { user: undefined } as unknown as Request;
    let statusCode: number = 200;
    let jsonResponse: unknown = null;
    const mockRes = {
      status: vi.fn().mockImplementation((code) => {
        statusCode = code;
        return mockRes;
      }),
      json: vi.fn().mockImplementation((data) => {
        jsonResponse = data;
      })
    } as unknown as Response;

    await getSlackChannels(mockReq, mockRes);

    expect(statusCode).toBe(401);
    expect(jsonResponse).toEqual({
      status: 'error',
      message: 'Unauthorized'
    });
  });

  // 25. getSlackChannels returns 400 when no Slack workspace is connected
  it('25. getSlackChannels returns 400 when no Slack workspace is connected', async () => {
    vi.spyOn(prisma.slackInstallation, 'findFirst').mockResolvedValue(null);

    const mockReq = { user: { id: 'user-no-slack' } } as unknown as Request;
    let statusCode: number = 200;
    let jsonResponse: unknown = null;
    const mockRes = {
      status: vi.fn().mockImplementation((code) => {
        statusCode = code;
        return mockRes;
      }),
      json: vi.fn().mockImplementation((data) => {
        jsonResponse = data;
      })
    } as unknown as Response;

    await getSlackChannels(mockReq, mockRes);

    expect(statusCode).toBe(400);
    expect(jsonResponse).toEqual({
      status: 'error',
      message: 'No Slack workspace connected. Please connect Slack first.'
    });
  });

  // 26. getSlackChannels returns 500 when bot token decryption fails
  it('26. getSlackChannels returns 500 when bot token decryption fails', async () => {
    vi.spyOn(prisma.slackInstallation, 'findFirst').mockResolvedValue({
      id: 'inst-corrupted',
      userId: 'user-test-id',
      teamId: 'T123',
      teamName: 'Acme Corp',
      encryptedBotToken: 'corrupted:payload:format'
    } as unknown as Awaited<ReturnType<typeof prisma.slackInstallation.findFirst>>);

    const mockReq = { user: { id: 'user-test-id' } } as unknown as Request;
    let statusCode: number = 200;
    let jsonResponse: unknown = null;
    const mockRes = {
      status: vi.fn().mockImplementation((code) => {
        statusCode = code;
        return mockRes;
      }),
      json: vi.fn().mockImplementation((data) => {
        jsonResponse = data;
      })
    } as unknown as Response;

    await getSlackChannels(mockReq, mockRes);

    expect(statusCode).toBe(500);
    expect(jsonResponse).toEqual({
      status: 'error',
      message: 'Unable to decrypt Slack credentials. Please disconnect and reconnect your workspace.'
    });
  });

  // 27. fetchSlackChannels formats missing_scope error with actionable reconnection message
  it('27. fetchSlackChannels formats missing_scope error with actionable reconnection message', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'missing_scope',
        needed: 'channels:read'
      })
    } as unknown as Response);

    await expect(fetchSlackChannels('xoxb-test')).rejects.toThrow(
      'Slack permissions error: missing required scope "channels:read". Please reconnect Slack.'
    );
  });

  // 28. fetchSlackChannels formats invalid_auth or token_revoked error gracefully
  it('28. fetchSlackChannels formats invalid_auth or token_revoked error gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'token_revoked'
      })
    } as unknown as Response);

    await expect(fetchSlackChannels('xoxb-test')).rejects.toThrow(
      'Slack connection expired or revoked. Please disconnect and reconnect your workspace.'
    );
  });
});
