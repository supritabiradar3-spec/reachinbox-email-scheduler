import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  startSlackOAuth,
  slackOAuthCallback,
  getSlackStatus,
  getSlackChannels,
  disconnectSlack
} from '../controllers/slack.controller.js';

const router = Router();

// OAuth routes (start and callback)
router.get('/oauth/start', requireAuth, startSlackOAuth);
router.get('/oauth/callback', requireAuth, slackOAuthCallback);

// Status and Channels
router.get('/status', requireAuth, getSlackStatus);
router.get('/channels', requireAuth, getSlackChannels);

// Disconnect
router.post('/disconnect', requireAuth, disconnectSlack);

export default router;
