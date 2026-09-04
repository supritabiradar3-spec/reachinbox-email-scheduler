import { z } from 'zod';

export interface EtherealSenderConfig {
  key: string;
  displayName: string;
  fromEmail: string;
  host: string;
  port: number;
  user: string;
  pass: string;
  secure?: boolean;
}

export interface SafeSenderInfo {
  key: string;
  displayName: string;
  fromEmail: string;
}

const senderConfigSchema = z.object({
  key: z.string().min(1, 'Sender key cannot be empty'),
  displayName: z.string().min(1, 'Display name cannot be empty'),
  fromEmail: z.string().email('Invalid from email address'),
  host: z.string().min(1, 'SMTP host is required').default('smtp.ethereal.email'),
  port: z.number().int().positive().default(587),
  user: z.string().min(1, 'SMTP username/user is required'),
  pass: z.string().min(1, 'SMTP password/pass is required'),
  secure: z.boolean().optional().default(false)
});

const sendersListSchema = z.array(senderConfigSchema).min(1, 'At least one sender must be configured');

/**
 * Parses and returns all configured Ethereal SMTP senders strictly from process.env.ETHEREAL_SENDERS_JSON.
 * Never uses dummy, invented, or fallback credentials.
 */
export const getConfiguredSenders = (): EtherealSenderConfig[] => {
  const rawEnv = process.env.ETHEREAL_SENDERS_JSON;
  if (!rawEnv || rawEnv.trim() === '') {
    return [];
  }

  try {
    const parsedJson = JSON.parse(rawEnv);
    const validation = sendersListSchema.safeParse(parsedJson);
    if (validation.success) {
      return validation.data;
    }
    console.warn('[SendersConfig] Warning: ETHEREAL_SENDERS_JSON failed schema validation. No senders configured.');
    return [];
  } catch {
    console.warn('[SendersConfig] Warning: Could not parse ETHEREAL_SENDERS_JSON as JSON. No senders configured.');
    return [];
  }
};

/**
 * Returns safe sender information (key, displayName, fromEmail) stripped of SMTP passwords and host credentials.
 */
export const getSafeSenders = (): SafeSenderInfo[] => {
  const senders = getConfiguredSenders();
  return senders.map((s) => ({
    key: s.key,
    displayName: s.displayName,
    fromEmail: s.fromEmail
  }));
};

/**
 * Finds a sender by its unique sender key.
 */
export const getSenderByKey = (key: string): EtherealSenderConfig | undefined => {
  const senders = getConfiguredSenders();
  return senders.find((s) => s.key === key);
};

/**
 * Checks if a sender key is currently configured.
 */
export const isValidSenderKey = (key: string): boolean => {
  return Boolean(getSenderByKey(key));
};

