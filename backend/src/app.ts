import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import healthRoutes from './routes/health.routes.js';

export const createApp = (): Express => {
  const app = express();

  app.use(cors({
    origin: config.clientUrl,
    credentials: true
  }));
  app.use(express.json());

  // API Routes
  app.use('/api', healthRoutes);

  // Root endpoint info
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'ReachInbox Email Scheduler API',
      version: '1.0.0',
      phase: 1,
      status: 'active',
      endpoints: {
        health: '/api/health'
      }
    });
  });

  return app;
};
