import { createApp } from './app.js';
import { config } from './config/env.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(`[Backend] ReachInbox Scheduler API running on port ${config.port} (${config.nodeEnv})`);
  console.log(`[Backend] Health check: http://localhost:${config.port}/api/health`);
});
