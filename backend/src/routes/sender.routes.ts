import { Router } from 'express';
import { getSenders } from '../controllers/sender.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

// GET /api/senders - Protected endpoint for sender selection
router.get('/', requireAuth, getSenders);

export default router;

