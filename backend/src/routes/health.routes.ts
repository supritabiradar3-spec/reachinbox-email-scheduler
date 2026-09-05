import { Router } from 'express';
import { getHealth, getDependenciesHealth } from '../controllers/health.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

// GET /api/health - Public uptime and environment status
router.get('/health', getHealth);

// GET /api/health/dependencies - Authenticated system infrastructure health
router.get('/health/dependencies', requireAuth, getDependenciesHealth);

export default router;
