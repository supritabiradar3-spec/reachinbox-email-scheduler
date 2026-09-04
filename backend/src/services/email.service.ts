import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { getSenderByKey, getConfiguredSenders, EtherealSenderConfig } from '../config/senders.config.js';

// Transporter cache per sender key
const transporterCache = new Map<string, Transporter>();

/**
 * Retrieves or lazily creates a nodemailer Transporter for a specific sender config.
 */
export const getTransporter = (sender: EtherealSenderConfig): Transporter => {
  if (transporterCache.has(sender.key)) {
    return transporterCache.get(sender.key)!;
  }

  const transporter = nodemailer.createTransport({
    host: sender.host,
    port: sender.port,
    secure: sender.secure ?? false,
    auth: {
      user: sender.user,
      pass: sender.pass
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  transporterCache.set(sender.key, transporter);
  return transporter;
};

/**
 * Verifies all configured SMTP transporters at worker startup.
 * Logs status safely without exposing passwords or host credentials.
 */
export const verifyAllTransporters = async (): Promise<void> => {
  const senders = getConfiguredSenders();
  if (senders.length === 0) {
    throw new Error('Ethereal SMTP senders are not configured. Please define ETHEREAL_SENDERS_JSON in backend/.env.');
  }

  for (const sender of senders) {
    try {
      const transporter = getTransporter(sender);
      await transporter.verify();
      console.log(`[SMTP] Transporter for sender [${sender.key}] (${sender.fromEmail}) verified successfully.`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      console.warn(`[SMTP] Transporter verification failed for sender [${sender.key}]: ${sanitizeError(message)}`);
    }
  }
};

export interface SendEmailParams {
  senderKey: string;
  recipientEmail: string;
  subject: string;
  body: string;
}

export interface SendEmailResult {
  messageId: string;
  etherealPreviewUrl: string | null;
}

/**
 * Sends a plain-text email message via the selected Ethereal sender.
 * Generates an Ethereal preview URL if available.
 */
export const sendEmail = async (params: SendEmailParams): Promise<SendEmailResult> => {
  const sender = getSenderByKey(params.senderKey);
  if (!sender) {
    throw new Error(`Sender with key '${params.senderKey}' is not configured.`);
  }

  const transporter = getTransporter(sender);
  const fromAddress = `"${sender.displayName}" <${sender.fromEmail}>`;

  const info = await transporter.sendMail({
    from: fromAddress,
    to: params.recipientEmail,
    subject: params.subject,
    text: params.body
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);

  return {
    messageId: info.messageId || `msg-${Date.now()}`,
    etherealPreviewUrl: typeof previewUrl === 'string' ? previewUrl : null
  };
};

/**
 * Sanitizes error messages to remove sensitive connection strings, auth tokens, or passwords.
 */
export const sanitizeError = (error: unknown): string => {
  if (!error) return 'Unknown error';
  const raw = error instanceof Error ? error.message : String(error);
  // Strip password patterns and credentials from error text
  return raw
    .replace(/(?:pass|password|auth|token|secret|session|key)=["']?[^"'\s&]+["']?/gi, 'credential=[REDACTED]')
    .replace(/:\/\/(?:[^:@\s]+)?(?::[^@\s]+)?@/g, '://[REDACTED]:[REDACTED]@')
    .slice(0, 1000);
};
