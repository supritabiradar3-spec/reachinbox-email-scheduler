import { Queue } from 'bullmq';
import { config } from '../config/env.js';

export const EMAIL_QUEUE_NAME = 'email-dispatch-queue';

/**
 * Generates a deterministic BullMQ job ID for a scheduled email record.
 */
export const getDeterministicJobId = (emailId: string): string => {
  return `email-${emailId}`;
};

// Create BullMQ Queue instance connected to Redis
export const emailQueue = new Queue(EMAIL_QUEUE_NAME, {
  connection: {
    url: config.redisUrl,
    maxRetriesPerRequest: null
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000
    },
    removeOnComplete: {
      age: 86400,
      count: 5000
    },
    removeOnFail: {
      age: 604800,
      count: 5000
    }
  }
});

/**
 * Adds a deterministic delayed email dispatch job to BullMQ.
 */
export const addEmailJob = async (
  emailId: string,
  scheduledAt: Date
): Promise<string> => {
  const jobId = getDeterministicJobId(emailId);
  const delayMs = Math.max(0, scheduledAt.getTime() - Date.now());

  await emailQueue.add(
    'send-email',
    { emailId },
    {
      jobId,
      delay: delayMs
    }
  );

  return jobId;
};
