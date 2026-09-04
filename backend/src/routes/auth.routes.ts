import { Router } from 'express';
import passport from 'passport';
import { getMe, googleCallbackSuccess, logout } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { config } from '../config/env.js';

const router = Router();

// GET /api/auth/google - Initiate Google OAuth 2.0 flow
router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account'
  })
);

// GET /api/auth/google/callback - Google OAuth callback handler
router.get(
  '/google/callback',
  passport.authenticate('google', {
    failureRedirect: `${config.clientUrl}?auth_error=google_auth_failed`
  }),
  googleCallbackSuccess
);

// GET /api/auth/me - Current authenticated user profile
router.get('/me', requireAuth, getMe);

// POST /api/auth/logout - End user session
router.post('/logout', requireAuth, logout);

export default router;
