import prisma from '../config/database';
import logger from '../config/logger';
import { computeAndApplyLateFees } from '../modules/collections/service';

/** Run daily late-fee computation. Intended to be scheduled by server startup cron or external scheduler. */
export async function runLateFeeWorker(
  societyId?: string,
  options?: { triggerSource?: 'SCHEDULED' | 'MANUAL'; triggeredByUserId?: string | null },
) {
  const triggerSource = options?.triggerSource || 'SCHEDULED';
  const societies = societyId
    ? [{ id: societyId }]
    : await prisma.society.findMany({ select: { id: true } });
  const runs: Array<{
    societyId: string;
    triggerSource: 'SCHEDULED' | 'MANUAL';
    success: boolean;
    billsScannedCount: number;
    updatedBillsCount: number;
    failedBillsCount: number;
    errorMessage: string | null;
    startedAt: Date;
    completedAt: Date;
  }> = [];

  for (const society of societies) {
    const startedAt = new Date();
    try {
      logger.info('lateFeeWorker: starting', { societyId: society.id, triggerSource });
      const summary = await computeAndApplyLateFees(society.id);
      const completedAt = new Date();

      await prisma.lateFeeJobRun.create({
        data: {
          societyId: society.id,
          triggerSource,
          triggeredByUserId: options?.triggeredByUserId || null,
          success: true,
          billsScannedCount: summary.billsScannedCount,
          updatedBillsCount: summary.updatedBillsCount,
          failedBillsCount: summary.failedBillsCount,
          startedAt,
          completedAt,
        },
      });

      logger.info('lateFeeWorker: finished', { societyId: society.id, triggerSource, ...summary });
      runs.push({
        societyId: society.id,
        triggerSource,
        success: true,
        billsScannedCount: summary.billsScannedCount,
        updatedBillsCount: summary.updatedBillsCount,
        failedBillsCount: summary.failedBillsCount,
        errorMessage: null,
        startedAt,
        completedAt,
      });
    } catch (err: any) {
      const completedAt = new Date();
      const errorMessage = err?.message || 'Unknown error';
      logger.error('lateFeeWorker: failed', { societyId: society.id, triggerSource, error: errorMessage });

      await prisma.lateFeeJobRun.create({
        data: {
          societyId: society.id,
          triggerSource,
          triggeredByUserId: options?.triggeredByUserId || null,
          success: false,
          billsScannedCount: 0,
          updatedBillsCount: 0,
          failedBillsCount: 0,
          errorMessage,
          startedAt,
          completedAt,
        },
      });

      runs.push({
        societyId: society.id,
        triggerSource,
        success: false,
        billsScannedCount: 0,
        updatedBillsCount: 0,
        failedBillsCount: 0,
        errorMessage,
        startedAt,
        completedAt,
      });
    }
  }

  return {
    totalUpdated: runs.reduce((sum, run) => sum + run.updatedBillsCount, 0),
    runs,
  };
}

export default runLateFeeWorker;
