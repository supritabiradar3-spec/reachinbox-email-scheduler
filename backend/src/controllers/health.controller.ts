import { Request, Response } from 'express';
import { config } from '../config/env.js';

export const getHealth = (_req: Request, res: Response): void => {
  res.status(200).json({
    status: 'ok',
    service: 'reachinbox-email-scheduler-backend',
    phase: 1,
    environment: config.nodeEnv,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
};
