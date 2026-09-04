import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env.js';

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    return next();
  }

  res.status(401).json({
    status: 'error',
    message: 'Unauthorized. Please sign in with Google to access this resource.'
  });
};

/**
 * Dedicated Bull Board authentication middleware.
 * Safely redirects unauthenticated browser requests to the frontend login
 * while returning JSON 401 to automated API requests.
 */
export const requireBullBoardAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    return next();
  }

  // If request is from a browser expecting HTML, redirect to frontend login
  if (req.accepts('html')) {
    return res.redirect(`${config.clientUrl}?auth_error=unauthorized`);
  }

  res.status(401).json({
    status: 'error',
    message: 'Unauthorized. Please sign in with Google to access the queue monitor.'
  });
};
