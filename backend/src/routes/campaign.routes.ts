import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { createCampaign } from '../controllers/campaign.controller.js';

const router = Router();

// POST /api/campaigns - Create and schedule email campaign
router.post('/', requireAuth, createCampaign);

export default router;
