import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import passport from 'passport';
import { config } from './config/env.js';
import { sessionRedisClient } from './config/redis.js';
import { configurePassport } from './config/passport.js';
import { requireAuth, requireBullBoardAuth } from './middleware/auth.middleware.js';
import { bullBoardRouter } from './config/bullBoard.js';
import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';
import campaignRoutes from './routes/campaign.routes.js';
import emailRoutes from './routes/email.routes.js';
import senderRoutes from './routes/sender.routes.js';
import slackRoutes from './routes/slack.routes.js';

export const createApp = (): Express => {
  const app = express();

  if (config.nodeEnv === 'production') {
    app.set('trust proxy', 1);
  }

  // CORS configuration
  app.use(
    cors({
      origin: config.clientUrl,
      credentials: true
    })
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Redis Session Store using official node-redis client
  const redisStore = new RedisStore({
    client: sessionRedisClient,
    prefix: 'reachinbox:sess:'
  });

  // Express Session
  app.use(
    session({
      store: redisStore,
      name: 'reachinbox.sid',
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      }
    })
  );

  // Passport initialization
  configurePassport();
  app.use(passport.initialize());
  app.use(passport.session());

  // Protected Bull Board Queue Monitor Route
  app.use('/admin/queues', requireBullBoardAuth, bullBoardRouter);

  // API Routes
  app.use('/api', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/campaigns', campaignRoutes);
  app.use('/api/emails', emailRoutes);
  app.use('/api/senders', senderRoutes);
  app.use('/api/slack', slackRoutes);

  // Root endpoint info
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'ReachInbox Email Scheduler API',
      version: '1.0.0',
      phase: 8,
      status: 'active',
      endpoints: {
        health: '/api/health',
        auth: {
          google: '/api/auth/google',
          googleCallback: '/api/auth/google/callback',
          me: '/api/auth/me',
          logout: '/api/auth/logout'
        },
        slack: {
          start: '/api/slack/oauth/start',
          callback: '/api/slack/oauth/callback',
          status: '/api/slack/status',
          channels: '/api/slack/channels',
          disconnect: 'POST /api/slack/disconnect'
        },
        admin: {
          queues: '/admin/queues'
        },
        senders: {
          list: 'GET /api/senders'
        },
        campaigns: {
          create: 'POST /api/campaigns'
        },
        emails: {
          scheduled: 'GET /api/emails/scheduled',
          sent: 'GET /api/emails/sent',
          search: 'GET /api/emails/search'
        }
      }
    });
  });

  return app;
};
