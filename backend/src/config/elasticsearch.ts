import { Client } from '@elastic/elasticsearch';
import { config } from './env.js';

export const SENT_EMAILS_INDEX = 'reachinbox-sent-emails';

/**
 * Singleton Elasticsearch client instance.
 */
export const elasticsearchClient = new Client({
  node: config.elasticsearchUrl
});

/**
 * Explicit schema and field mappings for sent email documents in Elasticsearch.
 * Ensures full-text search capability on subject and body, and exact filtering on userId, status, senderKey, recipientEmail.
 */
export const SENT_EMAILS_MAPPING_PROPERTIES = {
  id: { type: 'keyword' as const },
  userId: { type: 'keyword' as const },
  campaignId: { type: 'keyword' as const },
  recipientEmail: {
    type: 'keyword' as const,
    fields: {
      text: { type: 'text' as const }
    }
  },
  senderKey: { type: 'keyword' as const },
  subject: { type: 'text' as const },
  body: { type: 'text' as const },
  status: { type: 'keyword' as const },
  scheduledAt: { type: 'date' as const },
  sentAt: { type: 'date' as const },
  smtpMessageId: { type: 'keyword' as const },
  etherealPreviewUrl: { type: 'keyword' as const, index: false },
  createdAt: { type: 'date' as const }
};

export interface SentEmailDocument {
  id: string;
  userId: string;
  campaignId: string;
  recipientEmail: string;
  senderKey: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  smtpMessageId: string | null;
  etherealPreviewUrl: string | null;
  createdAt: string;
}
