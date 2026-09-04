import { 
  elasticsearchClient, 
  SENT_EMAILS_INDEX, 
  SENT_EMAILS_MAPPING_PROPERTIES, 
  SentEmailDocument 
} from '../config/elasticsearch.js';
import { prisma } from '../config/prisma.js';
import { sanitizeError } from './email.service.js';

/**
 * Builds a clean, sanitized Elasticsearch document from a ScheduledEmail database record.
 * Never includes SMTP credentials, OAuth tokens, or session information.
 */
export const buildSentEmailDocument = (email: {
  id: string;
  campaignId: string;
  senderKey: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: Date;
  sentAt: Date | null;
  smtpMessageId: string | null;
  etherealPreviewUrl: string | null;
  createdAt: Date;
  campaign?: {
    userId: string;
  } | null;
  userId?: string;
}): SentEmailDocument => {
  const userId = email.userId || email.campaign?.userId;
  if (!userId) {
    throw new Error(`Cannot build sent email document for email ${email.id}: missing userId.`);
  }

  return {
    id: email.id,
    userId,
    campaignId: email.campaignId,
    recipientEmail: email.recipientEmail,
    senderKey: email.senderKey,
    subject: email.subject,
    body: email.body,
    status: email.status,
    scheduledAt: email.scheduledAt.toISOString(),
    sentAt: email.sentAt ? email.sentAt.toISOString() : null,
    smtpMessageId: email.smtpMessageId,
    etherealPreviewUrl: email.etherealPreviewUrl,
    createdAt: email.createdAt.toISOString()
  };
};

/**
 * Ensures the 'reachinbox-sent-emails' index exists with explicit mappings.
 * Idempotent: Never deletes or recreates an existing index during startup.
 */
export const ensureSentEmailsIndex = async (): Promise<boolean> => {
  try {
    const exists = await elasticsearchClient.indices.exists({ index: SENT_EMAILS_INDEX });
    if (!exists) {
      await elasticsearchClient.indices.create({
        index: SENT_EMAILS_INDEX,
        mappings: {
          properties: SENT_EMAILS_MAPPING_PROPERTIES
        }
      });
      console.log(`[Elasticsearch] Created index '${SENT_EMAILS_INDEX}' with explicit mappings.`);
    } else {
      console.log(`[Elasticsearch] Index '${SENT_EMAILS_INDEX}' is active.`);
    }
    return true;
  } catch (err: unknown) {
    console.warn(`[Elasticsearch] Warning: Could not initialize index '${SENT_EMAILS_INDEX}': ${sanitizeError(err)}`);
    return false;
  }
};

/**
 * Indexes a single sent email into Elasticsearch.
 * Uses the ScheduledEmail.id as document _id for deterministic upserts.
 * Non-blocking / safe: Failures are logged and never revert database SENT status.
 */
export const indexSentEmail = async (emailId: string): Promise<boolean> => {
  try {
    const emailRecord = await prisma.scheduledEmail.findUnique({
      where: { id: emailId },
      include: {
        campaign: {
          select: { userId: true }
        }
      }
    });

    if (!emailRecord) {
      console.warn(`[Elasticsearch] Cannot index email ${emailId}: record not found in database.`);
      return false;
    }

    if (!emailRecord.campaign?.userId) {
      console.warn(`[Elasticsearch] Cannot index email ${emailId}: missing campaign userId.`);
      return false;
    }

    const document = buildSentEmailDocument(emailRecord);

    await elasticsearchClient.index({
      index: SENT_EMAILS_INDEX,
      id: document.id,
      document,
      refresh: true
    });

    console.log(`[Elasticsearch] Successfully indexed sent email ${emailId} into '${SENT_EMAILS_INDEX}'.`);
    return true;
  } catch (err: unknown) {
    console.error(`[Elasticsearch] Failed to index sent email ${emailId}: ${sanitizeError(err)}`);
    return false;
  }
};

/**
 * Reconciles / backfills existing SENT emails from MySQL into Elasticsearch.
 * Idempotently upserts missing or updated documents without duplicating records or resending emails.
 */
export const backfillSentEmailsToIndex = async (): Promise<number> => {
  try {
    const sentEmails = await prisma.scheduledEmail.findMany({
      where: { status: 'SENT' },
      include: {
        campaign: {
          select: { userId: true }
        }
      }
    });

    let indexedCount = 0;
    for (const email of sentEmails) {
      if (!email.campaign?.userId) continue;

      const document = buildSentEmailDocument(email);
      await elasticsearchClient.index({
        index: SENT_EMAILS_INDEX,
        id: document.id,
        document
      });
      indexedCount++;
    }

    if (indexedCount > 0) {
      await elasticsearchClient.indices.refresh({ index: SENT_EMAILS_INDEX });
    }

    console.log(`[Elasticsearch] Backfilled ${indexedCount} sent emails into '${SENT_EMAILS_INDEX}'.`);
    return indexedCount;
  } catch (err: unknown) {
    console.warn(`[Elasticsearch] Warning: Backfill operation encountered an issue: ${sanitizeError(err)}`);
    return 0;
  }
};

export interface SearchParams {
  userId: string;
  query: string;
  page?: number;
  limit?: number;
}

export interface SearchResultItem {
  id: string;
  recipientEmail: string;
  senderKey: string;
  subject: string;
  sentAt: string | null;
  status: string;
  smtpMessageId?: string | null;
  etherealPreviewUrl?: string | null;
  snippet?: string | null;
}

export interface SearchResultResponse {
  emails: SearchResultItem[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * Searches sent emails belonging exclusively to the authenticated user.
 * Performs full-text matching on subject, body, and recipientEmail with user-level isolation.
 */
export const searchUserSentEmails = async ({
  userId,
  query,
  page = 1,
  limit = 20
}: SearchParams): Promise<SearchResultResponse> => {
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(100, Math.max(1, limit));
  const from = (safePage - 1) * safeLimit;

  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return {
      emails: [],
      pagination: {
        total: 0,
        page: safePage,
        limit: safeLimit,
        totalPages: 0
      }
    };
  }

  const response = await elasticsearchClient.search<SentEmailDocument>({
    index: SENT_EMAILS_INDEX,
    from,
    size: safeLimit,
    query: {
      bool: {
        filter: [
          { term: { userId } }
        ],
        must: [
          {
            multi_match: {
              query: trimmedQuery,
              fields: [
                'subject^3',
                'recipientEmail.text^2',
                'recipientEmail^2',
                'body'
              ],
              fuzziness: 'AUTO'
            }
          }
        ]
      }
    },
    highlight: {
      fields: {
        subject: { number_of_fragments: 0 },
        body: { fragment_size: 140, number_of_fragments: 1 }
      }
    },
    sort: [
      { sentAt: { order: 'desc', missing: '_last' } },
      { createdAt: { order: 'desc' } }
    ]
  });

  const totalHits = typeof response.hits.total === 'number' 
    ? response.hits.total 
    : (response.hits.total?.value || 0);

  const emails: SearchResultItem[] = response.hits.hits.map((hit) => {
    const source = hit._source!;
    const highlight = hit.highlight;
    const snippet = highlight?.body?.[0] || (source.body ? source.body.slice(0, 140) + '...' : null);

    return {
      id: source.id,
      recipientEmail: source.recipientEmail,
      senderKey: source.senderKey,
      subject: source.subject,
      sentAt: source.sentAt,
      status: source.status,
      smtpMessageId: source.smtpMessageId,
      etherealPreviewUrl: source.etherealPreviewUrl,
      snippet
    };
  });

  return {
    emails,
    pagination: {
      total: totalHits,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(totalHits / safeLimit)
    }
  };
};
