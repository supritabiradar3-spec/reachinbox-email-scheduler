import { Request, Response } from 'express';
import { EmailStatus } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { searchUserSentEmails } from '../services/elasticsearch.service.js';

/**
 * Retrieves paginated scheduled emails belonging exclusively to the authenticated user.
 */
export const getScheduledEmails = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
  const skip = (page - 1) * limit;

  try {
    const whereClause = {
      campaign: {
        userId: req.user.id
      },
      status: 'SCHEDULED' as const
    };

    const [total, emails] = await Promise.all([
      prisma.scheduledEmail.count({ where: whereClause }),
      prisma.scheduledEmail.findMany({
        where: whereClause,
        select: {
          id: true,
          senderKey: true,
          recipientEmail: true,
          subject: true,
          scheduledAt: true,
          status: true
        },
        orderBy: { scheduledAt: 'asc' },
        skip,
        take: limit
      })
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      status: 'success',
      emails: emails.map((e) => ({
        id: e.id,
        senderKey: e.senderKey,
        recipientEmail: e.recipientEmail,
        subject: e.subject,
        scheduledAt: e.scheduledAt.toISOString(),
        status: e.status
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages
      }
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch scheduled emails';
    res.status(500).json({ status: 'error', message });
  }
};

/**
 * Retrieves paginated sent emails belonging exclusively to the authenticated user.
 */
export const getSentEmails = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
  const skip = (page - 1) * limit;

  try {
    const whereClause = {
      campaign: {
        userId: req.user.id
      },
      status: { in: [EmailStatus.SENT, EmailStatus.FAILED] }
    };

    const [total, emails] = await Promise.all([
      prisma.scheduledEmail.count({ where: whereClause }),
      prisma.scheduledEmail.findMany({
        where: whereClause,
        select: {
          id: true,
          senderKey: true,
          recipientEmail: true,
          subject: true,
          sentAt: true,
          status: true,
          smtpMessageId: true,
          etherealPreviewUrl: true
        },
        orderBy: [{ sentAt: 'desc' }, { updatedAt: 'desc' }],
        skip,
        take: limit
      })
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      status: 'success',
      emails: emails.map((e) => ({
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
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch sent emails';
    res.status(500).json({ status: 'error', message });
  }
};

/**
 * Searches sent emails belonging exclusively to the authenticated user via Elasticsearch.
 */
export const searchSentEmails = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  const query = (req.query.q as string) || '';
  if (!query.trim()) {
    res.status(400).json({
      status: 'error',
      message: 'Search query parameter "q" is required and cannot be empty.'
    });
    return;
  }

  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));

  try {
    const result = await searchUserSentEmails({
      userId: req.user.id,
      query,
      page,
      limit
    });

    res.json({
      status: 'success',
      query: query.trim(),
      emails: result.emails,
      pagination: result.pagination
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to execute search query';
    res.status(500).json({ status: 'error', message });
  }
};

