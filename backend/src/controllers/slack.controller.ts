import { Request, Response } from 'express';
import crypto from 'crypto';
import { config, isSlackConfigured } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { encryptSlackToken, decryptSlackToken } from '../services/slackCrypto.service.js';
import { exchangeSlackOAuthCode, fetchSlackChannels } from '../services/slack.service.js';

declare module 'express-session' {
  interface SessionData {
    slackOAuthState?: string;
  }
}

/**
 * Generates a cryptographically random single-use state token (64 hex characters / 32 bytes).
 */
export const generateSlackOAuthState = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Builds the safe Slack OAuth 2.0 authorization URL.
 */
export const generateSlackOAuthUrl = (state: string): string => {
  const clientId = process.env.SLACK_CLIENT_ID || config.slack.clientId;
  const redirectUri = process.env.SLACK_REDIRECT_URI || config.slack.redirectUri;
  const scopes = 'chat:write,channels:read,groups:read';
  const authorizeUrl = new URL('https://slack.com/oauth/v2/authorize');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('scope', scopes);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);
  return authorizeUrl.toString();
};

/**
 * Initiates the Slack OAuth 2.0 flow for the authenticated user.
 */
export const startSlackOAuth = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  if (!isSlackConfigured()) {
    res.status(400).json({
      status: 'error',
      message: 'Slack integration is not configured. Please set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, and SLACK_TOKEN_ENCRYPTION_KEY in backend/.env.'
    });
    return;
  }

  const state = generateSlackOAuthState();
  req.session.slackOAuthState = state;

  await new Promise<void>((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });

  const authorizeUrl = generateSlackOAuthUrl(state);
  res.redirect(authorizeUrl);
};

/**
 * Handles the Slack OAuth 2.0 callback, state validation, and token persistence.
 */
export const slackOAuthCallback = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.redirect(`${config.clientUrl}?slack_error=unauthorized`);
    return;
  }

  const { code, state, error } = req.query;

  if (error) {
    res.redirect(`${config.clientUrl}?slack_error=${encodeURIComponent(String(error))}`);
    return;
  }

  if (!state || typeof state !== 'string' || !req.session.slackOAuthState || state !== req.session.slackOAuthState) {
    delete req.session.slackOAuthState;
    res.redirect(`${config.clientUrl}?slack_error=invalid_state`);
    return;
  }

  // Clear single-use OAuth state token
  delete req.session.slackOAuthState;

  if (!code || typeof code !== 'string') {
    res.redirect(`${config.clientUrl}?slack_error=missing_code`);
    return;
  }

  try {
    const tokenData = await exchangeSlackOAuthCode(code);
    const encryptedToken = encryptSlackToken(tokenData.access_token);

    await prisma.slackInstallation.upsert({
      where: {
        userId_teamId: {
          userId: req.user.id,
          teamId: tokenData.team.id
        }
      },
      update: {
        teamName: tokenData.team.name || 'Slack Workspace',
        botUserId: tokenData.bot_user_id || '',
        encryptedBotToken: encryptedToken,
        scopes: tokenData.scope || 'chat:write,channels:read,groups:read'
      },
      create: {
        userId: req.user.id,
        teamId: tokenData.team.id,
        teamName: tokenData.team.name || 'Slack Workspace',
        botUserId: tokenData.bot_user_id || '',
        encryptedBotToken: encryptedToken,
        scopes: tokenData.scope || 'chat:write,channels:read,groups:read'
      }
    });

    res.redirect(`${config.clientUrl}?slack_connected=true`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'oauth_failed';
    console.error('[Slack] OAuth callback error:', err);
    res.redirect(`${config.clientUrl}?slack_error=${encodeURIComponent(message)}`);
  }
};

/**
 * Retrieves the current user's safe Slack connection status without exposing tokens.
 */
export const getSlackStatus = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  try {
    const installation = await prisma.slackInstallation.findFirst({
      where: { userId: req.user.id },
      select: {
        id: true,
        teamName: true,
        teamId: true,
        createdAt: true
      }
    });

    res.json({
      status: 'success',
      configured: isSlackConfigured(),
      connected: Boolean(installation),
      installation: installation
        ? {
            id: installation.id,
            teamName: installation.teamName,
            teamId: installation.teamId,
            createdAt: installation.createdAt.toISOString()
          }
        : null,
      installationId: installation?.id || null,
      teamName: installation?.teamName || null,
      teamId: installation?.teamId || null,
      connectedAt: installation?.createdAt ? installation.createdAt.toISOString() : null
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve Slack status';
    res.status(500).json({ status: 'error', message });
  }
};

/**
 * Retrieves accessible channels for the authenticated user's Slack workspace.
 */
export const getSlackChannels = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  try {
    const installation = await prisma.slackInstallation.findFirst({
      where: { userId: req.user.id }
    });

    if (!installation) {
      res.status(400).json({
        status: 'error',
        message: 'No Slack workspace connected. Please connect Slack first.'
      });
      return;
    }

    let botToken: string;
    try {
      botToken = decryptSlackToken(installation.encryptedBotToken);
    } catch (decryptErr: unknown) {
      console.error('[Slack] Failed to decrypt stored bot token for user');
      res.status(500).json({
        status: 'error',
        message: 'Unable to decrypt Slack credentials. Please disconnect and reconnect your workspace.'
      });
      return;
    }

    const channels = await fetchSlackChannels(botToken);

    res.json({
      status: 'success',
      teamName: installation.teamName,
      channels
    });
  } catch (err: unknown) {
    const sanitized = err instanceof Error ? err.message : 'Failed to retrieve Slack channels';
    console.error(`[Slack] Error fetching channels: ${sanitized}`);
    res.status(500).json({ status: 'error', message: sanitized });
  }
};

/**
 * Disconnects the Slack workspace for the authenticated user.
 */
export const disconnectSlack = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  try {
    const installation = await prisma.slackInstallation.findFirst({
      where: { userId: req.user.id }
    });

    if (installation) {
      await prisma.$transaction([
        prisma.emailCampaign.updateMany({
          where: { slackInstallationId: installation.id },
          data: {
            slackInstallationId: null,
            slackChannelId: null,
            slackChannelName: null,
            slackNotificationStatus: 'NOT_REQUESTED'
          }
        }),
        prisma.slackInstallation.delete({
          where: { id: installation.id }
        })
      ]);
    }

    res.json({
      status: 'success',
      message: 'Slack workspace disconnected successfully'
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to disconnect Slack workspace';
    res.status(500).json({ status: 'error', message });
  }
};
