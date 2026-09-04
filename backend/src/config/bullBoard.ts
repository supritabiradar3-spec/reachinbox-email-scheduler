import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { emailQueue } from '../queues/email.queue.js';

export const bullBoardServerAdapter = new ExpressAdapter();
bullBoardServerAdapter.setBasePath('/admin/queues');

export const { addQueue, removeQueue, setQueues, replaceQueues } = createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter: bullBoardServerAdapter
});

export const bullBoardRouter = bullBoardServerAdapter.getRouter();
