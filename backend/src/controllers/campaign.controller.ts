import { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { addEmailJob } from '../queues/email.queue.js';
import { 
  createCampaignSchema, 
  deduplicateRecipients, 
  calculateScheduledTime 
} from '../validators/campaign.validator.js';
import { decryptSlackToken } from '../services/slackCrypto.service.js';
import { verifySlackChannel } from '../services/slack.service.js';

/**
 * Handles creation and scheduling of email campaigns.
 * Uses idempotency keys, MySQL transactions, and delayed BullMQ jobs.
 */
export const createCampaign = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  // Validate request payload
  const parseResult = createCampaignSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors: parseResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message
      }))
    });
    return;
  }

  const input = parseResult.data;
  const idempotencyKey = 
    (req.headers['idempotency-key'] as string) || 
    (req.body.idempotencyKey as string) || 
    `idemp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  try {
    // Check for existing campaign with identical user and idempotency key
    const existingCampaign = await prisma.emailCampaign.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: req.user.id,
          idempotencyKey
        }
      },
      include: {
        emails: {
          select: {
            id: true,
            senderKey: true,
            recipientEmail: true,
            subject: true,
            scheduledAt: true,
            status: true
          },
          orderBy: { scheduledAt: 'asc' }
        }
      }
    });

    if (existingCampaign) {
      res.status(200).json({
        status: 'success',
        message: 'Campaign already scheduled (idempotent replay)',
        campaign: {
          id: existingCampaign.id,
          senderKey: existingCampaign.senderKey,
          subject: existingCampaign.subject,
          startTime: existingCampaign.startTime.toISOString(),
          delaySeconds: existingCampaign.delaySeconds,
          hourlyLimit: existingCampaign.hourlyLimit,
          recipientCount: existingCampaign.recipientCount,
          createdAt: existingCampaign.createdAt.toISOString(),
          slackNotificationStatus: existingCampaign.slackNotificationStatus,
          slackChannelName: existingCampaign.slackChannelName
        },
        emails: existingCampaign.emails.map((email) => ({
          ...email,
          scheduledAt: email.scheduledAt.toISOString()
        }))
      });
      return;
    }

    // Verify Slack configuration if requested
    let slackInstallationId: string | null = null;
    let slackChannelId: string | null = null;
    let slackChannelName: string | null = null;
    let slackNotificationStatus: 'NOT_REQUESTED' | 'PENDING' = 'NOT_REQUESTED';

    if (input.notifySlack && input.slackInstallationId && input.slackChannelId) {
      const installation = await prisma.slackInstallation.findFirst({
        where: {
          id: input.slackInstallationId,
          userId: req.user.id
        }
      });

      if (!installation) {
        res.status(400).json({
          status: 'error',
          message: 'Selected Slack workspace installation does not exist or does not belong to you'
        });
        return;
      }

      try {
        const botToken = decryptSlackToken(installation.encryptedBotToken);
        const verifiedChannel = await verifySlackChannel(botToken, input.slackChannelId);
        slackInstallationId = installation.id;
        slackChannelId = verifiedChannel.id;
        slackChannelName = verifiedChannel.name || input.slackChannelName || null;
        slackNotificationStatus = 'PENDING';
      } catch (slackVerifyErr: unknown) {
        const errMsg = slackVerifyErr instanceof Error ? slackVerifyErr.message : 'Invalid Slack channel';
        res.status(400).json({
          status: 'error',
          message: `Slack channel verification failed: ${errMsg}`
        });
        return;
      }
    }

    // Deduplicate recipients case-insensitively
    const uniqueRecipients = deduplicateRecipients(input.recipients);
    if (uniqueRecipients.length === 0) {
      res.status(400).json({
        status: 'error',
        message: 'At least one valid recipient email is required'
      });
      return;
    }

    const startDateTime = new Date(input.startTime);

    // Save campaign and scheduled emails in a single MySQL transaction
    const { campaign, createdEmails } = await prisma.$transaction(async (tx) => {
      const newCampaign = await tx.emailCampaign.create({
        data: {
          userId: req.user!.id,
          senderKey: input.senderKey,
          subject: input.subject,
          body: input.body,
          startTime: startDateTime,
          delaySeconds: input.delaySeconds,
          hourlyLimit: input.hourlyLimit,
          recipientCount: uniqueRecipients.length,
          idempotencyKey,
          slackInstallationId,
          slackChannelId,
          slackChannelName,
          slackNotificationStatus
        }
      });

      const emailRecordsData = uniqueRecipients.map((recipientEmail, index) => {
        const scheduledAt = calculateScheduledTime(startDateTime, index, input.delaySeconds);
        return {
          campaignId: newCampaign.id,
          senderKey: input.senderKey,
          recipientEmail,
          subject: input.subject,
          body: input.body,
          scheduledAt,
          status: 'SCHEDULED' as const
        };
      });

      await tx.scheduledEmail.createMany({
        data: emailRecordsData
      });

      const emails = await tx.scheduledEmail.findMany({
        where: { campaignId: newCampaign.id },
        orderBy: { scheduledAt: 'asc' }
      });

      return { campaign: newCampaign, createdEmails: emails };
    });

    // Enqueue delayed BullMQ jobs
    for (const email of createdEmails) {
      try {
        const jobId = await addEmailJob(email.id, email.scheduledAt);
        await prisma.scheduledEmail.update({
          where: { id: email.id },
          data: { bullmqJobId: jobId }
        });
      } catch (queueErr: unknown) {
        const queueErrMsg = queueErr instanceof Error ? queueErr.message : 'Queue error';
        console.warn(`[Queue] Failed to enqueue initial job for email ${email.id}:`, queueErrMsg);
      }
    }

    res.status(201).json({
      status: 'success',
      message: 'Campaign scheduled successfully',
      campaign: {
        id: campaign.id,
        senderKey: campaign.senderKey,
        subject: campaign.subject,
        startTime: campaign.startTime.toISOString(),
        delaySeconds: campaign.delaySeconds,
        hourlyLimit: campaign.hourlyLimit,
        recipientCount: campaign.recipientCount,
        createdAt: campaign.createdAt.toISOString(),
        slackNotificationStatus: campaign.slackNotificationStatus,
        slackChannelName: campaign.slackChannelName
      },
      emails: createdEmails.map((email) => ({
        id: email.id,
        senderKey: email.senderKey,
        recipientEmail: email.recipientEmail,
        subject: email.subject,
        scheduledAt: email.scheduledAt.toISOString(),
        status: email.status
      }))
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to schedule campaign';
    console.error('[Campaign] Scheduling error:', err);
    res.status(500).json({
      status: 'error',
      message
    });
  }
};
