import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { getScheduledEmails, getSentEmails } from '../controllers/email.controller.js';

const router = Router();

// GET /api/emails/scheduled - Get paginated scheduled emails
router.get('/scheduled', requireAuth, getScheduledEmails);

// GET /api/emails/sent - Get paginated sent emails
router.get('/sent', requireAuth, getSentEmails);

export default router;
