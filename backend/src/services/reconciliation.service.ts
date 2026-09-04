import { prisma } from '../config/prisma.js';
import { emailQueue, addEmailJob, getDeterministicJobId } from '../queues/email.queue.js';

export interface ReconciliationResult {
  totalChecked: number;
  reconciled: number;
  alreadyQueued: number;
}

/**
 * Reconciles scheduled emails on backend startup.
 * Checks for future SCHEDULED emails and re-adds any missing deterministic BullMQ jobs.
 * Never touches SENT emails or duplicates existing jobs.
 */
export const reconcileScheduledEmails = async (): Promise<ReconciliationResult> => {
  const result: ReconciliationResult = {
    totalChecked: 0,
    reconciled: 0,
    alreadyQueued: 0
  };

  try {
    const now = new Date();

    // Query all SCHEDULED emails (both future and overdue)
    const pendingEmails = await prisma.scheduledEmail.findMany({
      where: {
        status: 'SCHEDULED'
      },
      select: {
        id: true,
        scheduledAt: true,
        bullmqJobId: true
      }
    });

    result.totalChecked = pendingEmails.length;

    if (pendingEmails.length === 0) {
      console.log('[Reconciliation] No pending scheduled emails to reconcile.');
      return result;
    }

    for (const email of pendingEmails) {
      const expectedJobId = getDeterministicJobId(email.id);

      try {
        const existingJob = await emailQueue.getJob(expectedJobId);

        if (!existingJob) {
          // Re-add missing BullMQ job
          const jobId = await addEmailJob(email.id, email.scheduledAt);
          
          if (email.bullmqJobId !== jobId) {
            await prisma.scheduledEmail.update({
              where: { id: email.id },
              data: { bullmqJobId: jobId }
            });
          }

          result.reconciled++;
        } else {
          result.alreadyQueued++;
        }
      } catch (jobErr: unknown) {
        const errMessage = jobErr instanceof Error ? jobErr.message : 'Unknown error';
        console.warn(`[Reconciliation] Warning checking job ${expectedJobId}:`, errMessage);
      }
    }

    console.log(
      `[Reconciliation] Complete. Checked: ${result.totalChecked}, Reconciled missing: ${result.reconciled}, Already queued: ${result.alreadyQueued}`
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown reconciliation error';
    console.warn('[Reconciliation] Reconciliation skipped due to error:', message);
  }

  return result;
};
