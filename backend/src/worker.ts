import { Worker, Job, DelayedError } from 'bullmq';
import { config } from './config/env.js';
import { prisma } from './config/prisma.js';
import { getConfiguredSenders } from './config/senders.config.js';
import { EMAIL_QUEUE_NAME } from './queues/email.queue.js';
import { sendEmail, verifyAllTransporters, sanitizeError } from './services/email.service.js';
import {
  indexSentEmail,
  ensureSentEmailsIndex,
  indexScheduledEmail,
  ensureScheduledEmailsIndex,
  deleteScheduledEmailDoc
} from './services/elasticsearch.service.js';
import { reserveDispatchSlot } from './services/rateLimiter.service.js';
import { checkAndSendCampaignSlackNotification, checkAndSendRateLimitSlackNotification } from './services/slack.service.js';

// Pre-flight check: Fail fast if no valid Ethereal SMTP senders are configured
const configuredSenders = getConfiguredSenders();
if (configuredSenders.length === 0) {
  console.error('[Worker] Fatal: Ethereal SMTP senders are not configured.');
  console.error('[Worker] Please define a valid ETHEREAL_SENDERS_JSON array in backend/.env before starting the worker.');
  process.exit(1);
}

/**
 * Validates and bounds worker concurrency to a safe positive integer (1 to 50).
 */
export const getWorkerConcurrency = (): number => {
  const raw = process.env.WORKER_CONCURRENCY;
  const parsed = parseInt(raw || '5', 10);
  if (isNaN(parsed) || parsed < 1) {
    return 5;
  }
  return Math.min(parsed, 50);
};

const concurrency = getWorkerConcurrency();

/**
 * ==============================================================================
 * ReachInbox Email Scheduler - BullMQ Background Worker (Phase 7 & 8)
 * ==============================================================================
 *
 * Distributed Rate Limiting & Exactly-Once Delivery Architecture:
 * ---------------------------------------------------------------
 * 1. Redis Atomic Rate Reservation:
 *    - Rolling 60-minute window for tenant + sender `hourlyLimit`.
 *    - Minimum dispatch interval for tenant + sender `delaySeconds`.
 *    - Evaluated atomically in Redis via Lua before acquiring processing lock.
 * 2. Non-Destructive Delay Lifecycle:
 *    - Rate-limited jobs are marked `RATE_LIMITED` and deferred with `job.moveToDelayed()`.
 *    - Job maintains deterministic ID (`email-${id}`) and is not counted as a failure.
 * 3. Idempotency & Concurrency Locks:
 *    - Pre-flight verification skips already `SENT` records permanently.
 *    - Atomic MySQL lock (`status: { not: 'SENT' }` -> `status: 'PROCESSING'`).
 * 4. Multi-sender SMTP & Resilient Elasticsearch Indexing:
 *    - Success on SMTP is authoritative even if ES indexing is deferred.
 * 5. Slack Notifications:
 *    - Real-time Slack alert on hourly limit hits with atomic Redis deduplication.
 *    - Atomically triggers Slack notification when all emails reach terminal state.
 * ==============================================================================
 */

export interface EmailJobData {
  emailId: string;
}

/**
 * Job processing function invoked for each delayed email job in the BullMQ queue.
 */
export const processEmailJob = async (
  job: Job<EmailJobData>,
  token?: string
): Promise<void> => {
  const { emailId } = job.data;

  if (!emailId || typeof emailId !== 'string') {
    console.warn(`[Worker] Job ${job.id} rejected: missing or invalid emailId in payload.`);
    return;
  }

  // 1. Fetch ScheduledEmail record with Campaign relation from MySQL
  const emailRecord = await prisma.scheduledEmail.findUnique({
    where: { id: emailId },
    include: {
      campaign: {
        select: {
          id: true,
          userId: true,
          senderKey: true,
          subject: true,
          hourlyLimit: true,
          delaySeconds: true,
          slackInstallationId: true,
          slackChannelId: true,
          slackChannelName: true
        }
      }
    }
  });

  if (!emailRecord) {
    console.warn(`[Worker] ScheduledEmail record with ID ${emailId} not found in database. Skipping.`);
    return;
  }

  // 2. Pre-check: Skip permanently if email is already marked as SENT
  if (emailRecord.status === 'SENT') {
    console.log(`[Worker] Email ${emailId} is already marked as SENT. Skipping duplicate transmission.`);
    return;
  }

  // 3. Distributed Redis Rate Limit Reservation (Rolling 60m hourly limit & delay interval)
  if (emailRecord.campaign) {
    const senderKey = emailRecord.senderKey || emailRecord.campaign.senderKey;
    const reservation = await reserveDispatchSlot({
      userId: emailRecord.campaign.userId,
      senderKey,
      campaignId: emailRecord.campaign.id,
      hourlyLimit: emailRecord.campaign.hourlyLimit,
      delaySeconds: emailRecord.campaign.delaySeconds,
      emailId: emailRecord.id
    });

    if (!reservation.allowed) {
      const waitMs = Math.max(1000, reservation.waitMs);
      const nextEligibleTime = reservation.nextAvailableAt || new Date(Date.now() + waitMs);

      // Update database status to RATE_LIMITED with deferred target time
      await prisma.scheduledEmail.update({
        where: { id: emailId },
        data: {
          status: 'RATE_LIMITED',
          scheduledAt: nextEligibleTime
        }
      });

      // Update Elasticsearch scheduled index (non-blocking)
      try {
        await indexScheduledEmail(emailId);
      } catch (esErr: unknown) {
        console.warn(`[Worker] Elasticsearch rate-limited indexing deferred/failed for email ${emailId}: ${sanitizeError(esErr)}`);
      }

      console.log(
        `[Worker] Email ${emailId} sender [${senderKey}] rate-limited (reason: ${reservation.reason}). Wait: ${waitMs}ms, next eligible: ${nextEligibleTime.toISOString()}.`
      );

      // Trigger Slack alert if and only if rate limit hit was due to HOURLY_LIMIT
      if (reservation.reason === 'HOURLY_LIMIT') {
        try {
          const alertSent = await checkAndSendRateLimitSlackNotification({
            userId: emailRecord.campaign.userId,
            senderKey,
            campaignId: emailRecord.campaign.id,
            campaignSubject: emailRecord.campaign.subject,
            hourlyLimit: emailRecord.campaign.hourlyLimit,
            waitMs,
            nextAvailableAt: nextEligibleTime,
            channelId: emailRecord.campaign.slackChannelId
          });
          if (alertSent) {
            console.log(`[Worker] Rate-limit Slack alert for sender [${senderKey}]: SENT`);
          } else {
            console.log(`[Worker] Rate-limit Slack alert for sender [${senderKey}]: SKIPPED`);
          }
        } catch (slackAlertErr: unknown) {
          console.warn(`[Worker] Rate-limit Slack alert for sender [${senderKey}]: FAILED (${sanitizeError(slackAlertErr)})`);
        }
      }

      // Move BullMQ job to delayed state without marking as FAILED
      if (token) {
        await job.moveToDelayed(Date.now() + waitMs, token);
        console.log(`[Worker] Email ${emailId} sender [${senderKey}] job deferred successfully.`);
        throw new DelayedError();
      }
      return;
    }
  }

  // 4. Atomic status transition: Transition from non-SENT to PROCESSING
  const lockResult = await prisma.scheduledEmail.updateMany({
    where: {
      id: emailId,
      status: { not: 'SENT' }
    },
    data: {
      status: 'PROCESSING'
    }
  });

  if (lockResult.count === 0) {
    console.log(`[Worker] Email ${emailId} could not be locked for processing (likely already sent). Skipping.`);
    return;
  }

  // Update Elasticsearch scheduled index to PROCESSING (non-blocking)
  try {
    await indexScheduledEmail(emailId);
  } catch (esErr: unknown) {
    console.warn(`[Worker] Elasticsearch processing indexing deferred/failed for email ${emailId}: ${sanitizeError(esErr)}`);
  }

  try {
    // 5. Dispatch email via Ethereal SMTP service using the campaign's senderKey
    const result = await sendEmail({
      senderKey: emailRecord.senderKey,
      recipientEmail: emailRecord.recipientEmail,
      subject: emailRecord.subject,
      body: emailRecord.body
    });

    // 6. On successful SMTP transmission: mark SENT with metadata
    await prisma.scheduledEmail.update({
      where: { id: emailId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        smtpMessageId: result.messageId,
        etherealPreviewUrl: result.etherealPreviewUrl,
        errorMessage: null,
        attemptCount: { increment: 1 }
      }
    });

    console.log(`[Worker] Email ${emailId} sent successfully via [${emailRecord.senderKey}]. Preview: ${result.etherealPreviewUrl || 'N/A'}`);

    // 6b. Index sent email into Elasticsearch (non-fatal if indexing fails, never resends email)
    try {
      await indexSentEmail(emailId);
    } catch (esErr: unknown) {
      console.warn(`[Worker] Elasticsearch indexing deferred/failed for email ${emailId}: ${sanitizeError(esErr)}`);
    }

    // 6c. Check if campaign completed and dispatch Slack notification if configured
    if (emailRecord.campaignId) {
      try {
        await checkAndSendCampaignSlackNotification(emailRecord.campaignId);
      } catch (slackErr: unknown) {
        console.warn(`[Worker] Slack notification check failed for campaign ${emailRecord.campaignId}: ${sanitizeError(slackErr)}`);
      }
    }
  } catch (error: unknown) {
    // If this is a BullMQ DelayedError from moving to delayed, let it bubble up cleanly
    if (error instanceof DelayedError || (error as Error)?.name === 'DelayedError') {
      throw error;
    }

    const sanitizedErrMsg = sanitizeError(error);
    const maxAttempts = job.opts?.attempts || 3;
    const currentAttempt = (emailRecord.attemptCount || 0) + 1;
    const isExhausted = currentAttempt >= maxAttempts;

    // 7. On SMTP failure: record sanitized error and update status
    await prisma.scheduledEmail.update({
      where: { id: emailId },
      data: {
        status: isExhausted ? 'FAILED' : 'SCHEDULED',
        errorMessage: sanitizedErrMsg,
        attemptCount: { increment: 1 }
      }
    });

    // Update Elasticsearch state: if FAILED, index to sent index & remove from scheduled index; if retrying, update scheduled index
    try {
      if (isExhausted) {
        await indexSentEmail(emailId);
      } else {
        await indexScheduledEmail(emailId);
      }
    } catch (esErr: unknown) {
      console.warn(`[Worker] Elasticsearch failure state indexing deferred/failed for email ${emailId}: ${sanitizeError(esErr)}`);
    }

    console.error(
      `[Worker] Error sending email ${emailId} (attempt ${currentAttempt}/${maxAttempts}) via [${emailRecord.senderKey}]: ${sanitizedErrMsg}`
    );

    // If all retry attempts are exhausted and email reaches terminal FAILED state, check campaign completion
    if (isExhausted && emailRecord.campaignId) {
      try {
        await checkAndSendCampaignSlackNotification(emailRecord.campaignId);
      } catch (slackErr: unknown) {
        console.warn(`[Worker] Slack notification check failed for exhausted campaign ${emailRecord.campaignId}: ${sanitizeError(slackErr)}`);
      }
    }

    // Re-throw so BullMQ triggers exponential backoff retry until maxAttempts
    throw new Error(sanitizedErrMsg);
  }
};

// Initialize BullMQ Worker
console.log('==============================================');
console.log('ReachInbox Email Scheduler - Worker Process');
console.log(`Phase 7: Distributed Rate Controller & Dispatcher (Concurrency: ${concurrency})`);
console.log(`Queue: ${EMAIL_QUEUE_NAME} | Redis: ${config.redisUrl}`);
console.log('==============================================');

export const emailWorker = new Worker<EmailJobData>(
  EMAIL_QUEUE_NAME,
  processEmailJob,
  {
    connection: {
      url: config.redisUrl,
      maxRetriesPerRequest: null
    },
    concurrency
  }
);

// Worker Lifecycle & Event Listeners
emailWorker.on('ready', async () => {
  console.log('[Worker] Worker connected to Redis and ready to process jobs.');
  await verifyAllTransporters();
  await ensureScheduledEmailsIndex();
  await ensureSentEmailsIndex();
});

emailWorker.on('completed', (job: Job) => {
  console.log(`[Worker] Job ${job.id} (email-${job.data?.emailId}) completed successfully.`);
});

emailWorker.on('failed', (job: Job | undefined, err: Error) => {
  if (err.name !== 'DelayedError') {
    console.warn(`[Worker] Job ${job?.id} failed: ${sanitizeError(err.message)}`);
  }
});

emailWorker.on('stalled', (jobId: string) => {
  console.warn(`[Worker] Job ${jobId} stalled and will be re-processed.`);
});

emailWorker.on('error', (err: Error) => {
  console.error('[Worker] Internal worker error:', sanitizeError(err.message));
});

// Graceful Shutdown
const shutdownWorker = async (signal: string) => {
  console.log(`[Worker] Received ${signal}. Gracefully closing worker...`);
  try {
    await emailWorker.close();
    await prisma.$disconnect();
    console.log('[Worker] Worker closed cleanly.');
    process.exit(0);
  } catch (err) {
    console.error('[Worker] Error during shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGINT', () => shutdownWorker('SIGINT'));
process.on('SIGTERM', () => shutdownWorker('SIGTERM'));
