import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env.js';

export const getMe = (req: Request, res: Response): void => {
  if (!req.user) {
    res.status(401).json({
      status: 'error',
      message: 'Unauthorized'
    });
    return;
  }

  const { name, email, avatarUrl } = req.user;

  res.json({
    user: {
      name: name || null,
      email,
      avatarUrl: avatarUrl || null
    }
  });
};

export const googleCallbackSuccess = (_req: Request, res: Response): void => {
  res.redirect(`${config.clientUrl}?auth_status=success`);
};

export const logout = (req: Request, res: Response, next: NextFunction): void => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }

    if (req.session) {
      req.session.destroy((sessionErr) => {
        if (sessionErr) {
          console.error('[Session] Error destroying session during logout:', sessionErr);
        }

        res.clearCookie('reachinbox.sid', {
          path: '/',
          httpOnly: true,
          secure: config.nodeEnv === 'production',
          sameSite: config.nodeEnv === 'production' ? 'none' : 'lax'
        });

        res.json({
          status: 'success',
          message: 'Logged out successfully'
        });
      });
    } else {
      res.clearCookie('reachinbox.sid', {
        path: '/',
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: config.nodeEnv === 'production' ? 'none' : 'lax'
      });

      res.json({
        status: 'success',
        message: 'Logged out successfully'
      });
    }
  });
};
