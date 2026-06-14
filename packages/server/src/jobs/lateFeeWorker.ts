import logger from '../config/logger';
import { computeAndApplyLateFees } from '../modules/collections/service';

/** Run daily late-fee computation. Intended to be scheduled by server startup cron or external scheduler. */
export async function runLateFeeWorker(societyId?: string) {
  try {
    logger.info('lateFeeWorker: starting', { societyId });
    const updated = await computeAndApplyLateFees(societyId);
    logger.info('lateFeeWorker: finished', { updated });
    return updated;
  } catch (err: any) {
    logger.error('lateFeeWorker: failed', { error: err?.message });
    throw err;
  }
}

export default runLateFeeWorker;
