import { Worker, Job } from 'bullmq';
import { config } from './config/env.js';
import { prisma } from './config/prisma.js';
import { getConfiguredSenders } from './config/senders.config.js';
import { EMAIL_QUEUE_NAME } from './queues/email.queue.js';
import { sendEmail, verifyAllTransporters, sanitizeError } from './services/email.service.js';

// Pre-flight check: Fail fast if no valid Ethereal SMTP senders are configured
const configuredSenders = getConfiguredSenders();
if (configuredSenders.length === 0) {
  console.error('[Worker] Fatal: Ethereal SMTP senders are not configured.');
  console.error('[Worker] Please define a valid ETHEREAL_SENDERS_JSON array in backend/.env before starting the worker.');
  process.exit(1);
}

const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);

/**
 * ==============================================================================
 * ReachInbox Email Scheduler - BullMQ Background Worker (Phase 5)
 * ==============================================================================
 *
 * Exactly-Once Delivery Architecture & SMTP Limitations:
 * ------------------------------------------------------
 * Due to the fundamental nature of network protocols and remote SMTP mail servers,
 * mathematically pure "exactly-once" delivery across distributed systems cannot be
 * 100% guaranteed if a catastrophic process or network crash occurs in the tiny
 * millisecond window between the SMTP provider accepting the email (RCPT TO/DATA)
 * and the local database status update committing.
 *
 * To minimize duplicate risks to near zero in production, this worker implements:
 * 1. Deterministic BullMQ job IDs (`email-${emailId}`) preventing duplicate queue entries.
 * 2. Atomic database conditional updates (`status: { not: 'SENT' }` -> `status: 'PROCESSING'`)
 *    preventing parallel execution by concurrent worker threads.
 * 3. Pre-flight idempotency checks verifying if the record is already `SENT` before SMTP dispatch.
 * 4. BullMQ job locks held during transmission.
 * ==============================================================================
 */

interface EmailJobData {
  emailId: string;
}

/**
 * Job processing function invoked for each delayed email job in the BullMQ queue.
 */
export const processEmailJob = async (job: Job<EmailJobData>): Promise<void> => {
  const { emailId } = job.data;

  if (!emailId || typeof emailId !== 'string') {
    console.warn(`[Worker] Job ${job.id} rejected: missing or invalid emailId in payload.`);
    return;
  }

  // 1. Fetch ScheduledEmail record from MySQL
  const emailRecord = await prisma.scheduledEmail.findUnique({
    where: { id: emailId }
  });

  if (!emailRecord) {
    console.warn(`[Worker] ScheduledEmail record with ID ${emailId} not found in database. Skipping.`);
    return;
  }

  // 2. Pre-check: Skip safely if email is already marked as SENT
  if (emailRecord.status === 'SENT') {
    console.log(`[Worker] Email ${emailId} is already marked as SENT. Skipping duplicate transmission.`);
    return;
  }

  // 3. Atomic status transition: Transition from non-SENT to PROCESSING
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

  try {
    // 4. Dispatch email via Ethereal SMTP service using the campaign's senderKey
    const result = await sendEmail({
      senderKey: emailRecord.senderKey,
      recipientEmail: emailRecord.recipientEmail,
      subject: emailRecord.subject,
      body: emailRecord.body
    });

    // 5. On successful SMTP transmission: mark SENT with metadata
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
  } catch (error: unknown) {
    const sanitizedErrMsg = sanitizeError(error);
    const maxAttempts = job.opts.attempts || 3;
    const currentAttempt = (emailRecord.attemptCount || 0) + 1;
    const isExhausted = currentAttempt >= maxAttempts;

    // 6. On failure: record sanitized error and update status
    await prisma.scheduledEmail.update({
      where: { id: emailId },
      data: {
        status: isExhausted ? 'FAILED' : 'SCHEDULED',
        errorMessage: sanitizedErrMsg,
        attemptCount: { increment: 1 }
      }
    });

    console.error(
      `[Worker] Error sending email ${emailId} (attempt ${currentAttempt}/${maxAttempts}) via [${emailRecord.senderKey}]: ${sanitizedErrMsg}`
    );

    // Re-throw so BullMQ triggers exponential backoff retry until maxAttempts
    throw new Error(sanitizedErrMsg);
  }
};

// Initialize BullMQ Worker
console.log('==============================================');
console.log('ReachInbox Email Scheduler - Worker Process');
console.log(`Phase 5: Ethereal SMTP Dispatcher (Concurrency: ${concurrency})`);
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
});

emailWorker.on('completed', (job: Job) => {
  console.log(`[Worker] Job ${job.id} (email-${job.data?.emailId}) completed successfully.`);
});

emailWorker.on('failed', (job: Job | undefined, err: Error) => {
  console.warn(`[Worker] Job ${job?.id} failed: ${sanitizeError(err.message)}`);
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
