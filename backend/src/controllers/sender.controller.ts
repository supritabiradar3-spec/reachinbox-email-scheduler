import { Request, Response } from 'express';
import { getSafeSenders } from '../config/senders.config.js';

/**
 * Returns the list of safe configured sender accounts for campaign dispatch.
 * Excludes all SMTP credentials and server connection secrets.
 */
export const getSenders = (_req: Request, res: Response): void => {
  const senders = getSafeSenders();
  if (senders.length === 0) {
    res.json({
      status: 'warning',
      message: 'No Ethereal SMTP senders configured. Please configure ETHEREAL_SENDERS_JSON in backend/.env.',
      senders: []
    });
    return;
  }

  res.json({
    status: 'success',
    senders
  });
};

