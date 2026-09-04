import { z } from 'zod';
import { isValidSenderKey } from '../config/senders.config.js';

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export const createCampaignSchema = z
  .object({
    senderKey: z
      .string()
      .trim()
      .min(1, 'Sender account selection is required')
      .refine((val) => isValidSenderKey(val), {
        message: 'Selected sender account is invalid or not configured'
      }),
    subject: z
      .string()
      .trim()
      .min(1, 'Subject is required and cannot be empty')
      .max(255, 'Subject exceeds 255 characters'),
    body: z
      .string()
      .trim()
      .min(1, 'Body is required and cannot be empty')
      .max(50000, 'Body exceeds 50,000 characters'),
    recipients: z
      .array(
        z
          .string()
          .trim()
          .refine((val) => EMAIL_REGEX.test(val), {
            message: 'Invalid email address format'
          })
      )
      .min(1, 'At least one recipient email is required')
      .max(10000, 'Recipient count exceeds 10,000 limit'),
    startTime: z
      .string()
      .min(1, 'Start time is required')
      .refine((val) => !isNaN(new Date(val).getTime()), {
        message: 'Invalid start time format'
      })
      .refine((val) => new Date(val).getTime() > Date.now() - 60000, {
        message: 'Start time cannot be in the past'
      }),
    delaySeconds: z
      .number()
      .int('Delay seconds must be an integer')
      .positive('Delay seconds must be greater than 0')
      .max(3600, 'Delay seconds cannot exceed 3600'),
    hourlyLimit: z
      .number()
      .int('Hourly limit must be an integer')
      .positive('Hourly limit must be greater than 0')
      .max(100000, 'Hourly limit cannot exceed 100,000'),
    notifySlack: z.boolean().optional(),
    slackInstallationId: z.string().uuid().optional(),
    slackChannelId: z.string().trim().min(1).optional(),
    slackChannelName: z.string().trim().optional()
  })
  .refine(
    (data) => {
      if (data.notifySlack) {
        return Boolean(data.slackInstallationId && data.slackChannelId);
      }
      return true;
    },
    {
      message: 'slackInstallationId and slackChannelId are required when notifySlack is true',
      path: ['slackChannelId']
    }
  );

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

/**
 * Normalizes and deduplicates email recipients case-insensitively.
 */
export const deduplicateRecipients = (recipients: string[]): string[] => {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const raw of recipients) {
    const email = raw.trim().toLowerCase();
    if (email && !seen.has(email)) {
      seen.add(email);
      unique.push(email);
    }
  }

  return unique;
};

/**
 * Calculates scheduled dispatch timestamp for a given recipient index.
 * scheduledAt = startTime + index * delaySeconds
 */
export const calculateScheduledTime = (
  startTime: Date,
  recipientIndex: number,
  delaySeconds: number
): Date => {
  return new Date(startTime.getTime() + recipientIndex * delaySeconds * 1000);
};
