import { Prisma } from '@prisma/client';
import prisma from '../../config/database';

export type CampaignTargetMode = 'all' | 'specific';

export async function logCrmAction(
  performedById: string,
  societyId: string,
  action: string,
  description?: string,
  metadata?: Record<string, unknown>,
) {
  await prisma.crmActionLog.create({
    data: {
      societyId,
      performedById,
      action,
      description: description ?? null,
      metadata: metadata ? (metadata as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  });
}

export const SOCIETY_CRM_SELECT = {
  id: true,
  name: true,
  communityType: true,
  city: true,
  state: true,
  pincode: true,
  address: true,
  registrationNo: true,
  isActive: true,
  isPremium: true,
  hadPremiumSubscription: true,
  premiumOverrideUntil: true,
  trialStartedAt: true,
  trialEndsAt: true,
  crmNotes: true,
  crmTags: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      users: true,
      blocks: true,
      complaints: true,
      expenses: true,
    },
  },
} as const;

export function escapeCsvValue(value: string | null | undefined) {
  if (value == null) return '';
  const text = String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function parseCampaignHistoryRecord(record: any) {
  return {
    ...record,
    requestedRecipients: record.requestedRecipients ? JSON.parse(record.requestedRecipients) : null,
    resolvedRecipients: record.resolvedRecipients ? JSON.parse(record.resolvedRecipients) : [],
    failedRecipients: record.failedRecipients ? JSON.parse(record.failedRecipients) : [],
  };
}