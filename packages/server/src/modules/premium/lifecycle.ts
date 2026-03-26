import type { PremiumSubscription, Role, Society } from '@prisma/client';
import prisma from '../../config/database';
import logger from '../../config/logger';
import {
  sendPremiumArchivedEmail,
  sendPremiumLoginBlockedEmail,
  sendPremiumOverdueWarningEmail,
} from '../../config/email';

const DAY_MS = 24 * 60 * 60 * 1000;

export const PREMIUM_WARNING_DAYS = 10;
export const PREMIUM_LOGIN_BLOCK_DAYS = 30;
export const PREMIUM_ARCHIVE_DAYS = 90;
export const PREMIUM_BLOCKED_ROLES: Role[] = ['SECRETARY', 'JOINT_SECRETARY', 'TREASURER'];
export const PREMIUM_WARNING_ROLES: Role[] = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER'];

export type PremiumLifecycleStage = 'CURRENT' | 'WARNING' | 'OVERDUE_RECOVERY' | 'ROLE_LOGIN_BLOCKED' | 'ARCHIVED';

export interface PremiumLifecycleState {
  isOverdue: boolean;
  stage: PremiumLifecycleStage;
  overdueStartedAt: Date | null;
  warningEndsAt: Date | null;
  loginBlockedAt: Date | null;
  archiveAt: Date | null;
  daysOverdue: number;
  adminCanRecover: boolean;
  affectedRoles: Role[];
}

type LifecycleSociety = Pick<Society, 'id' | 'name' | 'isActive' | 'isPremium' | 'hadPremiumSubscription' | 'premiumArchivedAt' | 'premiumArchiveReason'>;
type LifecycleSubscription = Pick<PremiumSubscription, 'id' | 'status' | 'overdueStartedAt' | 'nextBillingAt' | 'currentPeriodEnd' | 'cancelledAt' | 'updatedAt' | 'warningNoticeSentAt' | 'loginBlockedNoticeSentAt' | 'finalNoticeSentAt'>;

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * DAY_MS);
}

function floorDays(diffMs: number) {
  return Math.max(Math.floor(diffMs / DAY_MS), 0);
}

export function getBlockedPremiumRoles() {
  return [...PREMIUM_BLOCKED_ROLES];
}

export function shouldWarnPremiumRole(role: string) {
  return PREMIUM_WARNING_ROLES.includes(role as Role);
}

export function deriveOverdueStartedAt(subscription: Pick<PremiumSubscription, 'overdueStartedAt' | 'nextBillingAt' | 'currentPeriodEnd' | 'cancelledAt' | 'updatedAt'>, now = new Date()) {
  const anchor = subscription.overdueStartedAt || subscription.nextBillingAt || subscription.currentPeriodEnd || subscription.cancelledAt || subscription.updatedAt;
  if (!anchor) {
    return now;
  }

  return anchor.getTime() > now.getTime() ? now : anchor;
}

export function calculatePremiumLifecycle(overdueStartedAt?: Date | null, now = new Date()): PremiumLifecycleState {
  if (!overdueStartedAt) {
    return {
      isOverdue: false,
      stage: 'CURRENT',
      overdueStartedAt: null,
      warningEndsAt: null,
      loginBlockedAt: null,
      archiveAt: null,
      daysOverdue: 0,
      adminCanRecover: false,
      affectedRoles: [...PREMIUM_WARNING_ROLES],
    };
  }

  const warningEndsAt = addDays(overdueStartedAt, PREMIUM_WARNING_DAYS);
  const loginBlockedAt = addDays(overdueStartedAt, PREMIUM_LOGIN_BLOCK_DAYS);
  const archiveAt = addDays(overdueStartedAt, PREMIUM_ARCHIVE_DAYS);
  const diffMs = Math.max(now.getTime() - overdueStartedAt.getTime(), 0);
  const daysOverdue = floorDays(diffMs);

  let stage: PremiumLifecycleStage = 'WARNING';
  if (now.getTime() >= archiveAt.getTime()) {
    stage = 'ARCHIVED';
  } else if (now.getTime() >= loginBlockedAt.getTime()) {
    stage = 'ROLE_LOGIN_BLOCKED';
  } else if (now.getTime() >= warningEndsAt.getTime()) {
    stage = 'OVERDUE_RECOVERY';
  }

  return {
    isOverdue: true,
    stage,
    overdueStartedAt,
    warningEndsAt,
    loginBlockedAt,
    archiveAt,
    daysOverdue,
    adminCanRecover: stage !== 'ARCHIVED',
    affectedRoles: [...PREMIUM_WARNING_ROLES],
  };
}

export function shouldBlockPremiumRole(role: string, lifecycle: PremiumLifecycleState) {
  return lifecycle.stage === 'ROLE_LOGIN_BLOCKED' && PREMIUM_BLOCKED_ROLES.includes(role as Role);
}

export function buildPremiumLifecycleMessage(lifecycle: PremiumLifecycleState) {
  if (!lifecycle.isOverdue || !lifecycle.overdueStartedAt) {
    return null;
  }

  const loginBlockedAt = lifecycle.loginBlockedAt?.toLocaleDateString();
  const archiveAt = lifecycle.archiveAt?.toLocaleDateString();

  switch (lifecycle.stage) {
    case 'WARNING':
      return `Premium renewal payment is overdue. Please complete payment before ${loginBlockedAt} to avoid role restrictions.`;
    case 'OVERDUE_RECOVERY':
      return `Premium renewal payment is still overdue. Admin should complete payment before ${loginBlockedAt} to avoid Secretary and Treasurer access being blocked.`;
    case 'ROLE_LOGIN_BLOCKED':
      return `Premium renewal payment is overdue by ${lifecycle.daysOverdue} days. Secretary and Treasurer roles are blocked until Admin completes payment. The society will be archived on ${archiveAt} if payment is still not completed.`;
    case 'ARCHIVED':
      return 'This society has been archived because Premium renewal remained unpaid for more than 3 months.';
    default:
      return null;
  }
}

async function getLifecycleRecipients(societyId: string) {
  const memberships = await prisma.userSocietyMembership.findMany({
    where: {
      societyId,
      role: { in: PREMIUM_WARNING_ROLES },
      user: { isActive: true },
    },
    select: {
      role: true,
      user: {
        select: {
          email: true,
          name: true,
        },
      },
    },
  });

  return memberships
    .filter((membership) => membership.user.email)
    .map((membership) => ({
      role: membership.role,
      email: membership.user.email as string,
      name: membership.user.name,
    }));
}

async function sendLifecycleEmails(society: LifecycleSociety, subscription: LifecycleSubscription, lifecycle: PremiumLifecycleState) {
  const recipients = await getLifecycleRecipients(society.id);
  if (recipients.length === 0) {
    return;
  }

  try {
    if (lifecycle.stage === 'WARNING' && !subscription.warningNoticeSentAt) {
      await Promise.allSettled(
        recipients.map((recipient) =>
          sendPremiumOverdueWarningEmail(recipient.email, {
            userName: recipient.name,
            societyName: society.name,
            role: recipient.role,
            overdueStartedAt: lifecycle.overdueStartedAt!,
            loginBlockedAt: lifecycle.loginBlockedAt!,
            archiveAt: lifecycle.archiveAt!,
          }),
        ),
      );

      await prisma.premiumSubscription.update({
        where: { id: subscription.id },
        data: { warningNoticeSentAt: new Date() },
      });
      return;
    }

    if (lifecycle.stage === 'ROLE_LOGIN_BLOCKED' && !subscription.loginBlockedNoticeSentAt) {
      await Promise.allSettled(
        recipients.map((recipient) =>
          sendPremiumLoginBlockedEmail(recipient.email, {
            userName: recipient.name,
            societyName: society.name,
            role: recipient.role,
            overdueStartedAt: lifecycle.overdueStartedAt!,
            archiveAt: lifecycle.archiveAt!,
          }),
        ),
      );

      await prisma.premiumSubscription.update({
        where: { id: subscription.id },
        data: { loginBlockedNoticeSentAt: new Date() },
      });
      return;
    }

    if (lifecycle.stage === 'ARCHIVED' && !subscription.finalNoticeSentAt) {
      await Promise.allSettled(
        recipients.map((recipient) =>
          sendPremiumArchivedEmail(recipient.email, {
            userName: recipient.name,
            societyName: society.name,
            role: recipient.role,
            overdueStartedAt: lifecycle.overdueStartedAt!,
            archivedAt: society.premiumArchivedAt || new Date(),
          }),
        ),
      );

      await prisma.premiumSubscription.update({
        where: { id: subscription.id },
        data: { finalNoticeSentAt: new Date() },
      });
    }
  } catch (error: any) {
    logger.warn('Failed to send Premium lifecycle emails', { error: error.message, societyId: society.id, stage: lifecycle.stage });
  }
}

export async function ensurePremiumLifecycleForSociety(societyId: string) {
  const [society, latestSubscription] = await Promise.all([
    prisma.society.findUnique({
      where: { id: societyId },
      select: {
        id: true,
        name: true,
        isActive: true,
        isPremium: true,
        hadPremiumSubscription: true,
        premiumArchivedAt: true,
        premiumArchiveReason: true,
      },
    }),
    prisma.premiumSubscription.findFirst({
      where: { societyId, status: { not: 'PENDING' } },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        status: true,
        overdueStartedAt: true,
        nextBillingAt: true,
        currentPeriodEnd: true,
        cancelledAt: true,
        updatedAt: true,
        warningNoticeSentAt: true,
        loginBlockedNoticeSentAt: true,
        finalNoticeSentAt: true,
      },
    }),
  ]);

  if (!society) {
    return calculatePremiumLifecycle(null);
  }

  if (society.premiumArchivedAt || society.isActive === false) {
    const archivedLifecycle = calculatePremiumLifecycle(latestSubscription?.overdueStartedAt || society.premiumArchivedAt, society.premiumArchivedAt || new Date());
    return {
      ...archivedLifecycle,
      isOverdue: true,
      stage: 'ARCHIVED' as const,
      adminCanRecover: false,
    };
  }

  if (!latestSubscription || (!society.hadPremiumSubscription && latestSubscription.status !== 'ACTIVE')) {
    return calculatePremiumLifecycle(null);
  }

  if (latestSubscription.status === 'ACTIVE') {
    if (latestSubscription.overdueStartedAt || latestSubscription.warningNoticeSentAt || latestSubscription.loginBlockedNoticeSentAt || latestSubscription.finalNoticeSentAt) {
      await prisma.premiumSubscription.update({
        where: { id: latestSubscription.id },
        data: {
          overdueStartedAt: null,
          warningNoticeSentAt: null,
          loginBlockedNoticeSentAt: null,
          finalNoticeSentAt: null,
        },
      });
    }

    return calculatePremiumLifecycle(null);
  }

  const overdueStartedAt = deriveOverdueStartedAt(latestSubscription);
  if (!latestSubscription.overdueStartedAt) {
    await prisma.premiumSubscription.update({
      where: { id: latestSubscription.id },
      data: { overdueStartedAt },
    });
    latestSubscription.overdueStartedAt = overdueStartedAt;
  }

  const lifecycle = calculatePremiumLifecycle(overdueStartedAt);

  if (lifecycle.stage === 'ARCHIVED' && !society.premiumArchivedAt) {
    await prisma.society.update({
      where: { id: society.id },
      data: {
        isActive: false,
        isPremium: false,
        premiumArchivedAt: new Date(),
        premiumArchiveReason: 'PREMIUM_OVERDUE_90_DAYS',
      },
    });
    society.premiumArchivedAt = new Date();
    society.isActive = false;
  }

  await sendLifecycleEmails(society, latestSubscription, lifecycle);

  return lifecycle;
}