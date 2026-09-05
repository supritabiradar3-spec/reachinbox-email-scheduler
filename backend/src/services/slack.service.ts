import { config, isSlackConfigured } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { ioRedisClient } from '../config/redis.js';
import { getConfiguredSenders } from '../config/senders.config.js';
import { decryptSlackToken } from './slackCrypto.service.js';
import { sanitizeError } from './email.service.js';
import { getRateLimitAlertDedupKey } from './rateLimiter.service.js';

export interface SlackOAuthTokenResponse {
  ok: boolean;
  access_token: string;
  scope: string;
  bot_user_id: string;
  team: {
    id: string;
    name: string;
  };
  error?: string;
}

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
}

export interface CampaignNotificationStats {
  campaignSubject: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  completedAt: Date;
}

export interface RateLimitSlackAlertParams {
  userId: string;
  senderKey: string;
  campaignId?: string;
  campaignSubject?: string;
  hourlyLimit: number;
  waitMs: number;
  nextAvailableAt: Date;
  channelId?: string | null;
}

/**
 * Exchanges authorization code for a Slack bot access token via OAuth v2.
 */
export const exchangeSlackOAuthCode = async (code: string): Promise<SlackOAuthTokenResponse> => {
  if (!isSlackConfigured()) {
    throw new Error('Slack integration is not configured on this server.');
  }

  const clientId = process.env.SLACK_CLIENT_ID || config.slack.clientId;
  const clientSecret = process.env.SLACK_CLIENT_SECRET || config.slack.clientSecret;
  const redirectUri = process.env.SLACK_REDIRECT_URI || config.slack.redirectUri;

  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    }).toString()
  });

  const data = (await response.json()) as SlackOAuthTokenResponse;

  if (!data.ok) {
    const errorMsg = data.error || 'Failed to exchange Slack OAuth code';
    throw new Error(`Slack OAuth error: ${errorMsg}`);
  }

  return data;
};

/**
 * Fetches available public and private channels for the authenticated bot token.
 */
export const fetchSlackChannels = async (botToken: string): Promise<SlackChannel[]> => {
  if (!botToken) {
    throw new Error('Slack bot token is required to fetch channels.');
  }

  const channels: SlackChannel[] = [];
  let cursor: string | undefined = undefined;

  // Paginate through available channels
  do {
    const params = new URLSearchParams({
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: '200'
    });

    if (cursor) {
      params.set('cursor', cursor);
    }

    let response: Response;
    try {
      response = await fetch(`https://slack.com/api/conversations.list?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json; charset=utf-8'
        },
        signal: AbortSignal.timeout(15000)
      });
    } catch {
      // Retry once on transient connection timeout
      try {
        response = await fetch(`https://slack.com/api/conversations.list?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${botToken}`,
            'Content-Type': 'application/json; charset=utf-8'
          },
          signal: AbortSignal.timeout(15000)
        });
      } catch (retryErr: unknown) {
        throw new Error('Unable to connect to Slack API (network timeout or connection failure).');
      }
    }

    if (response.ok === false) {
      throw new Error(`Slack API HTTP error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      ok: boolean;
      channels?: Array<{ id: string; name: string; is_private?: boolean }>;
      response_metadata?: { next_cursor?: string };
      error?: string;
      needed?: string;
      provided?: string;
    };

    if (!data.ok) {
      const code = data.error || 'failed_to_list_channels';
      if (code === 'missing_scope') {
        throw new Error(`Slack permissions error: missing required scope "${data.needed || 'channels:read'}". Please reconnect Slack.`);
      }
      if (code === 'invalid_auth' || code === 'token_revoked' || code === 'account_inactive') {
        throw new Error('Slack connection expired or revoked. Please disconnect and reconnect your workspace.');
      }
      if (code === 'ratelimited') {
        throw new Error('Slack rate limit reached. Please wait a moment and try again.');
      }
      throw new Error(`Slack API error: ${code}`);
    }

    if (data.channels && Array.isArray(data.channels)) {
      for (const ch of data.channels) {
        channels.push({
          id: ch.id,
          name: ch.name,
          isPrivate: Boolean(ch.is_private)
        });
      }
    }

    cursor = data.response_metadata?.next_cursor;
  } while (cursor && cursor.length > 0);

  return channels;
};

/**
 * Verifies channel existence and bot accessibility via Slack conversations.info.
 */
export const verifySlackChannel = async (
  botToken: string,
  channelId: string
): Promise<{ id: string; name: string }> => {
  let response: Response;
  try {
    response = await fetch(
      `https://slack.com/api/conversations.info?channel=${encodeURIComponent(channelId)}`,
      {
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json; charset=utf-8'
        },
        signal: AbortSignal.timeout(15000)
      }
    );
  } catch {
    throw new Error('Unable to verify Slack channel due to a network connection error.');
  }

  const data = (await response.json()) as {
    ok: boolean;
    channel?: { id: string; name: string };
    error?: string;
  };

  if (!data.ok || !data.channel) {
    const code = data.error || 'channel_not_found';
    if (code === 'channel_not_found') {
      throw new Error(`Slack channel verification failed: channel_not_found (channel "${channelId}" not found or inaccessible by bot)`);
    }
    if (code === 'missing_scope') {
      throw new Error('Missing required Slack permissions to verify channel. Please reconnect Slack.');
    }
    throw new Error(`Slack channel verification failed: ${code}`);
  }

  return {
    id: data.channel.id,
    name: data.channel.name
  };
};

/**
 * Builds the sanitized Block Kit message payload for campaign completion.
 */
export const buildSlackCompletionMessage = (
  channelId: string,
  stats: CampaignNotificationStats
) => {
  const { campaignSubject, totalRecipients, sentCount, failedCount, completedAt } = stats;

  return {
    channel: channelId,
    text: `Campaign "${campaignSubject}" completed: ${sentCount}/${totalRecipients} sent, ${failedCount} failed.`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '📬 Email Campaign Completed',
          emoji: true
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Subject:*\n${campaignSubject}`
          },
          {
            type: 'mrkdwn',
            text: `*Completed At:*\n${completedAt.toUTCString()}`
          },
          {
            type: 'mrkdwn',
            text: `*Total Recipients:*\n${totalRecipients}`
          },
          {
            type: 'mrkdwn',
            text: `*Delivery Summary:*\n✅ *${sentCount}* Sent   |   ❌ *${failedCount}* Failed`
          }
        ]
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'ReachInbox Email Scheduler • Automated Delivery Notification'
          }
        ]
      }
    ]
  };
};

/**
 * Builds the sanitized Block Kit message payload for an hourly rate limit alert.
 * Ensures zero recipient emails, zero message bodies, and zero SMTP credentials/tokens are exposed.
 */
export const buildSlackRateLimitMessage = (
  channelId: string,
  params: {
    senderDisplayName: string;
    senderKey: string;
    hourlyLimit: number;
    campaignSubject?: string;
    nextAvailableAt: Date;
  }
) => {
  const { senderDisplayName, senderKey, hourlyLimit, campaignSubject, nextAvailableAt } = params;

  const fields: Array<{ type: 'mrkdwn'; text: string }> = [
    {
      type: 'mrkdwn',
      text: `*Sender:*\n${senderDisplayName} (\`${senderKey}\`)`
    },
    {
      type: 'mrkdwn',
      text: `*Hourly Limit:*\n${hourlyLimit} emails / hr`
    }
  ];

  if (campaignSubject) {
    fields.push({
      type: 'mrkdwn',
      text: `*Campaign:*\n${campaignSubject}`
    });
  }

  fields.push({
    type: 'mrkdwn',
    text: `*Next Eligible Dispatch:*\n<!date^${Math.floor(nextAvailableAt.getTime() / 1000)}^{date_num} {time_secs}|${nextAvailableAt.toUTCString()}>`
  });

  return {
    channel: channelId,
    text: `⚠️ Email hourly limit reached for sender "${senderDisplayName}" (${hourlyLimit} emails/hr). Dispatch temporarily deferred.`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '⚠️ Email Hourly Limit Reached',
          emoji: true
        }
      },
      {
        type: 'section',
        fields
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'ReachInbox Email Scheduler • Rate-limited jobs are deferred in queue and will dispatch automatically.'
          }
        ]
      }
    ]
  };
};

/**
 * Evaluates campaign email status and idempotently claims and sends a completion notification
 * if and only if all scheduled emails in the campaign have reached a terminal status (SENT or FAILED).
 */
export const checkAndSendCampaignSlackNotification = async (campaignId: string): Promise<void> => {
  if (!campaignId) return;

  try {
    // 1. Fetch Campaign and linked SlackInstallation
    const campaign = await prisma.emailCampaign.findUnique({
      where: { id: campaignId },
      include: {
        slackInstallation: true
      }
    });

    if (
      !campaign ||
      campaign.slackNotificationStatus !== 'PENDING' ||
      !campaign.slackInstallationId ||
      !campaign.slackChannelId ||
      !campaign.slackInstallation
    ) {
      return;
    }

    // 2. Verify all emails in the campaign are in a terminal state (SENT or FAILED)
    const nonTerminalCount = await prisma.scheduledEmail.count({
      where: {
        campaignId,
        status: { in: ['SCHEDULED', 'RATE_LIMITED', 'PROCESSING'] }
      }
    });

    if (nonTerminalCount > 0) {
      // Campaign has remaining non-terminal emails; defer notification until last job finishes
      return;
    }

    // 3. Atomic MySQL claim: transition PENDING -> PROCESSING
    const claimResult = await prisma.emailCampaign.updateMany({
      where: {
        id: campaignId,
        slackNotificationStatus: 'PENDING'
      },
      data: {
        slackNotificationStatus: 'PROCESSING'
      }
    });

    if (claimResult.count === 0) {
      // Another concurrent worker claimed the notification
      return;
    }

    // 4. Gather final campaign statistics
    const [sentCount, failedCount] = await Promise.all([
      prisma.scheduledEmail.count({ where: { campaignId, status: 'SENT' } }),
      prisma.scheduledEmail.count({ where: { campaignId, status: 'FAILED' } })
    ]);

    const stats: CampaignNotificationStats = {
      campaignSubject: campaign.subject,
      totalRecipients: campaign.recipientCount,
      sentCount,
      failedCount,
      completedAt: new Date()
    };

    // 5. Decrypt bot token immediately before posting
    const botToken = decryptSlackToken(campaign.slackInstallation.encryptedBotToken);

    // 6. Post Slack message
    const messagePayload = buildSlackCompletionMessage(campaign.slackChannelId, stats);

    const postResponse = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(messagePayload)
    });

    const postData = (await postResponse.json()) as { ok: boolean; error?: string };

    if (!postData.ok) {
      throw new Error(`Slack chat.postMessage failed: ${postData.error || 'unknown_slack_error'}`);
    }

    // 7. On success: transition to SENT
    await prisma.emailCampaign.update({
      where: { id: campaignId },
      data: {
        slackNotificationStatus: 'SENT',
        slackNotificationSentAt: new Date(),
        slackNotificationError: null
      }
    });

    console.log(`[Slack] Completion notification sent for campaign ${campaignId} to channel #${campaign.slackChannelName || campaign.slackChannelId}`);
  } catch (err: unknown) {
    const sanitizedError = sanitizeError(err);
    console.error(`[Slack] Error delivering campaign notification for ${campaignId}: ${sanitizedError}`);

    // Record failure in campaign record without affecting email statuses
    try {
      await prisma.emailCampaign.update({
        where: { id: campaignId },
        data: {
          slackNotificationStatus: 'FAILED',
          slackNotificationError: sanitizedError
        }
      });
    } catch {
      // Non-fatal catch
    }
  }
};

/**
 * Sends a real-time Slack notification when a sender reaches their configured hourly limit.
 * Uses atomic Redis SET NX for deduplication across distributed workers, dynamically retrieves
 * the tenant's Slack installation from the database, and safely no-ops if Slack is disconnected.
 */
export const checkAndSendRateLimitSlackNotification = async (
  params: RateLimitSlackAlertParams
): Promise<boolean> => {
  const { userId, senderKey, campaignSubject, hourlyLimit, waitMs, nextAvailableAt, channelId } = params;

  if (!userId || !senderKey) {
    return false;
  }

  try {
    // 1. Fetch active Slack installation dynamically from database
    const slackInstallation = await prisma.slackInstallation.findFirst({
      where: { userId }
    });

    if (!slackInstallation) {
      // Disconnected or not connected: safe no-op
      return false;
    }

    // 2. Determine target channel ID (from campaign or installation)
    const targetChannelId = channelId || null;
    if (!targetChannelId) {
      // No destination channel configured: safe no-op
      return false;
    }

    // 3. Deduplication via Redis SET NX
    // Deduplication key scopes to tenant/user and sender key with a bounded window TTL
    const dedupKey = getRateLimitAlertDedupKey(userId, senderKey);
    const ttlSeconds = Math.min(3600, Math.max(60, Math.ceil(waitMs / 1000)));

    const acquired = await ioRedisClient.set(dedupKey, '1', 'EX', ttlSeconds, 'NX');
    if (acquired !== 'OK') {
      // Duplicate alert in current window already handled by another worker
      return false;
    }

    // 4. Resolve friendly sender name from configuration (never exposes private SMTP credentials)
    const configuredSenders = getConfiguredSenders();
    const sender = configuredSenders.find((s) => s.key === senderKey);
    const senderDisplayName = sender?.displayName || senderKey;

    // 5. Decrypt bot token in memory immediately before posting
    const botToken = decryptSlackToken(slackInstallation.encryptedBotToken);

    // 6. Build Block Kit payload
    const payload = buildSlackRateLimitMessage(targetChannelId, {
      senderDisplayName,
      senderKey,
      hourlyLimit,
      campaignSubject,
      nextAvailableAt
    });

    // 7. Post message to live Slack API
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    const data = (await response.json()) as { ok: boolean; error?: string };
    if (!data.ok) {
      throw new Error(`Slack chat.postMessage failed: ${data.error || 'unknown_error'}`);
    }

    console.log(`[Slack] Rate limit alert sent for sender "${senderDisplayName}" to channel ${targetChannelId}`);
    return true;
  } catch (err: unknown) {
    const sanitizedError = sanitizeError(err);
    console.warn(`[Slack] Failed to send rate-limit Slack notification for user ${userId} / sender ${senderKey}: ${sanitizedError}`);
    // Safe failure: never throw or block worker processing
    return false;
  }
};
