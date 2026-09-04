import { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';

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
      status: 'SENT' as const
    };

    const [total, emails] = await Promise.all([
      prisma.scheduledEmail.count({ where: whereClause }),
      prisma.scheduledEmail.findMany({
        where: whereClause,
        select: {
          id: true,
          recipientEmail: true,
          subject: true,
          sentAt: true,
          status: true
        },
        orderBy: { sentAt: 'desc' },
        skip,
        take: limit
      })
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      status: 'success',
      emails: emails.map((e) => ({
        id: e.id,
        recipientEmail: e.recipientEmail,
        subject: e.subject,
        sentAt: e.sentAt ? e.sentAt.toISOString() : null,
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
    const message = err instanceof Error ? err.message : 'Failed to fetch sent emails';
    res.status(500).json({ status: 'error', message });
  }
};
