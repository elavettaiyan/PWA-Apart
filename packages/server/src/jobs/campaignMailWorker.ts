import { CampaignMailStatus } from '@prisma/client';
import prisma from '../config/database';
import { config } from '../config';
import logger from '../config/logger';
import { sendCampaignEmails } from '../config/email';

const CAMPAIGN_MAIL_BATCH_SIZE = 2;
let isWorkerRunning = false;
let hasLoggedSchemaMismatch = false;

function parseRecipientList(value: string | null | undefined) {
  if (!value) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function getCampaignCompletionStatus(failedCount: number) {
  return failedCount > 0 ? CampaignMailStatus.COMPLETED_WITH_ERRORS : CampaignMailStatus.COMPLETED;
}

export async function runCampaignMailWorker() {
  if (isWorkerRunning) {
    return;
  }

  isWorkerRunning = true;

  try {
    const campaign = await prisma.crmCampaignHistory.findFirst({
      where: {
        status: {
          in: [CampaignMailStatus.QUEUED, CampaignMailStatus.PROCESSING],
        },
      },
      orderBy: [
        { createdAt: 'asc' },
      ],
    });

    if (!campaign) {
      return;
    }

    const resolvedRecipients = parseRecipientList(campaign.resolvedRecipients);
    const existingFailedRecipients = parseRecipientList(campaign.failedRecipients);
    const processedCount = campaign.sentCount + campaign.failedCount;

    if (processedCount >= resolvedRecipients.length) {
      await prisma.crmCampaignHistory.update({
        where: { id: campaign.id },
        data: {
          status: getCampaignCompletionStatus(campaign.failedCount),
          completedAt: campaign.completedAt || new Date(),
        },
      });
      return;
    }

    if (campaign.status === CampaignMailStatus.QUEUED) {
      await prisma.crmCampaignHistory.update({
        where: { id: campaign.id },
        data: {
          status: CampaignMailStatus.PROCESSING,
          processingStartedAt: campaign.processingStartedAt || new Date(),
          lastErrorMessage: null,
        },
      });
    }

    const batchRecipients = resolvedRecipients.slice(processedCount, processedCount + CAMPAIGN_MAIL_BATCH_SIZE);
    const unsubscribeBaseUrl = `${config.publicServerUrl.replace(/\/$/, '')}/api/public/unsubscribe/campaign-email`;
    const result = await sendCampaignEmails({
      recipientEmails: batchRecipients,
      subject: campaign.subject,
      html: campaign.html,
      unsubscribeBaseUrl,
      intendedRecipientCount: campaign.intendedRecipientCount,
    });

    const nextSentCount = campaign.sentCount + result.sentCount;
    const nextFailedCount = campaign.failedCount + result.failedCount;
    const nextFailedRecipients = [...existingFailedRecipients, ...result.failedRecipients];
    const nextProcessedCount = nextSentCount + nextFailedCount;
    const isCompleted = nextProcessedCount >= resolvedRecipients.length;

    await prisma.crmCampaignHistory.update({
      where: { id: campaign.id },
      data: {
        sentCount: nextSentCount,
        failedCount: nextFailedCount,
        failedRecipients: nextFailedRecipients.length > 0 ? JSON.stringify(nextFailedRecipients) : null,
        status: isCompleted ? getCampaignCompletionStatus(nextFailedCount) : CampaignMailStatus.PROCESSING,
        completedAt: isCompleted ? new Date() : null,
        lastErrorMessage: result.failedCount > 0 ? `${result.failedCount} recipient email${result.failedCount === 1 ? '' : 's'} failed in the latest batch.` : null,
      },
    });
  } catch (error: any) {
    const errorMessage = error?.message || 'Unknown error';
    const isSchemaMismatch = errorMessage.includes('crm_campaign_history.status') || errorMessage.includes('crm_campaign_history.resolvedRecipients');

    if (isSchemaMismatch) {
      if (!hasLoggedSchemaMismatch) {
        logger.warn('campaignMailWorker: database schema not ready; worker paused until campaign mail migration is applied', {
          error: errorMessage,
        });
        hasLoggedSchemaMismatch = true;
      }
      return;
    }

    hasLoggedSchemaMismatch = false;
    logger.error('campaignMailWorker: failed', { error: errorMessage });
  } finally {
    isWorkerRunning = false;
  }
}

export default runCampaignMailWorker;