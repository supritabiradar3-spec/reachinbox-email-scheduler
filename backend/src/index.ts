import { createApp } from './app.js';
import { config } from './config/env.js';
import { connectSessionRedis } from './config/redis.js';
import { reconcileScheduledEmails } from './services/reconciliation.service.js';
import { ensureSentEmailsIndex, backfillSentEmailsToIndex } from './services/elasticsearch.service.js';

const startServer = async () => {
  // Connect session Redis client before starting the server
  await connectSessionRedis();

  // Run startup reconciliation for future scheduled emails
  await reconcileScheduledEmails();

  // Initialize Elasticsearch index and run safe backfill for existing sent emails
  await ensureSentEmailsIndex();
  await backfillSentEmailsToIndex();

  const app = createApp();

  app.listen(config.port, () => {
    console.log(`[Backend] ReachInbox Scheduler API running on port ${config.port} (${config.nodeEnv})`);
    console.log(`[Backend] Health check: http://localhost:${config.port}/api/health`);
  });
};

startServer().catch((err) => {
  console.error('[Backend] Failed to start server:', err);
});
