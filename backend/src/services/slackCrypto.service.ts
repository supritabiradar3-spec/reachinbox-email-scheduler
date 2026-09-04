import crypto from 'crypto';
import { config } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH_BYTES = 16; // 128-bit authentication tag

/**
 * Validates and converts the Slack token encryption key into a 32-byte (256-bit) Buffer.
 */
export const getEncryptionKeyBuffer = (customKey?: string): Buffer => {
  const rawKey = typeof customKey === 'string'
    ? customKey
    : (process.env.SLACK_TOKEN_ENCRYPTION_KEY || config.slack.tokenEncryptionKey);
  if (!rawKey || typeof rawKey !== 'string' || rawKey.trim().length === 0) {
    throw new Error('SLACK_TOKEN_ENCRYPTION_KEY is not configured or is empty.');
  }

  const trimmed = rawKey.trim();

  // If 64 hex characters (32 bytes in hex)
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  // If 32-byte UTF-8 string
  const utf8Buf = Buffer.from(trimmed, 'utf8');
  if (utf8Buf.length === 32) {
    return utf8Buf;
  }

  throw new Error('SLACK_TOKEN_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters or 32 ASCII characters).');
};

/**
 * Encrypts a Slack bot access token using AES-256-GCM with a fresh random IV.
 * Produces serialized ciphertext in the format: `ivHex:authTagHex:ciphertextHex`.
 */
export const encryptSlackToken = (plaintextToken: string, customKey?: string): string => {
  if (!plaintextToken || typeof plaintextToken !== 'string') {
    throw new Error('Cannot encrypt empty or non-string Slack token.');
  }

  const key = getEncryptionKeyBuffer(customKey);
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES
  });

  let ciphertext = cipher.update(plaintextToken, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;
};

/**
 * Decrypts an AES-256-GCM encrypted Slack bot access token and verifies authentication tag.
 */
export const decryptSlackToken = (serializedCiphertext: string, customKey?: string): string => {
  if (!serializedCiphertext || typeof serializedCiphertext !== 'string') {
    throw new Error('Cannot decrypt empty or non-string Slack ciphertext.');
  }

  const parts = serializedCiphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted Slack token format: expected iv:authTag:ciphertext.');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;

  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Corrupted encrypted Slack token structure.');
  }

  const key = getEncryptionKeyBuffer(customKey);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  if (iv.length !== IV_LENGTH_BYTES) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH_BYTES} bytes, got ${iv.length}.`);
  }

  if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error(`Invalid authentication tag length: expected ${AUTH_TAG_LENGTH_BYTES} bytes.`);
  }

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH_BYTES
    });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Decryption failed';
    throw new Error(`Failed to decrypt Slack access token: authentication tag validation failed (${message})`);
  }
};
