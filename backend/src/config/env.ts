import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientUrl: process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL || 'mysql://reachinbox_user:reachinbox_password@localhost:3307/reachinbox_scheduler',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  elasticsearchUrl: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
  sessionSecret: process.env.SESSION_SECRET || 'reachinbox_dev_session_secret_2026',
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/auth/google/callback'
  },
  slack: {
    clientId: process.env.SLACK_CLIENT_ID || '',
    clientSecret: process.env.SLACK_CLIENT_SECRET || '',
    redirectUri: process.env.SLACK_REDIRECT_URI || 'http://localhost:5000/api/slack/oauth/callback',
    tokenEncryptionKey: process.env.SLACK_TOKEN_ENCRYPTION_KEY || ''
  }
} as const;

export const isSlackConfigured = (): boolean => {
  const clientId = process.env.SLACK_CLIENT_ID || config.slack.clientId;
  const clientSecret = process.env.SLACK_CLIENT_SECRET || config.slack.clientSecret;
  const tokenEncryptionKey = process.env.SLACK_TOKEN_ENCRYPTION_KEY || config.slack.tokenEncryptionKey;
  return Boolean(
    clientId &&
    clientSecret &&
    tokenEncryptionKey
  );
};
