import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  getScheduledEmails,
  getSentEmails,
  searchSentEmails,
  searchScheduledEmails
} from '../controllers/email.controller.js';

const router = Router();

// GET /api/emails/scheduled/search - Full-text search scheduled emails via Elasticsearch
router.get('/scheduled/search', requireAuth, searchScheduledEmails);

// GET /api/emails/scheduled - Get paginated scheduled emails
router.get('/scheduled', requireAuth, getScheduledEmails);

// GET /api/emails/sent - Get paginated sent emails
router.get('/sent', requireAuth, getSentEmails);

// GET /api/emails/search - Full-text search sent emails via Elasticsearch
router.get('/search', requireAuth, searchSentEmails);

export default router;

