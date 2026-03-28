import type { Prisma, Role } from '@prisma/client';
import prisma from '../../config/database';
import logger from '../../config/logger';
import { sendMemberRemovalEmail } from '../../config/email';
import { invalidateAuthCache } from '../../middleware/auth';

export type MemberRemovalSource = 'MEMBERS_ROLES' | 'FLAT_MANAGEMENT';

type MemberRemovalArgs = {
  societyId: string;
  societyName: string;
  targetUserId?: string | null;
  targetRole: Role;
  removedByUserId: string;
  removedByRole: Role;
  reason: string;
  source: MemberRemovalSource;
  recipientEmail?: string | null;
  recipientName?: string | null;
  ownerId?: string | null;
  tenantId?: string | null;
  flatId?: string | null;
  snapshot?: Record<string, unknown>;
  removeData: (tx: Prisma.TransactionClient) => Promise<void>;
  deleteMembership?: boolean | ((tx: Prisma.TransactionClient) => Promise<boolean>);
};

async function syncUserMembershipState(tx: Prisma.TransactionClient, userId: string) {
  const [user, memberships] = await Promise.all([
    tx.user.findUnique({
      where: { id: userId },
      select: { activeSocietyId: true, societyId: true },
    }),
    tx.userSocietyMembership.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { societyId: true, role: true },
    }),
  ]);

  if (!user) return;

  if (memberships.length === 0) {
    await tx.user.update({
      where: { id: userId },
      data: {
        role: 'OWNER',
        societyId: null,
        activeSocietyId: null,
        isActive: false,
      },
    });
    return;
  }

  const activeMembership = memberships.find((membership) => membership.societyId === user.activeSocietyId);
  const defaultMembership = memberships.find((membership) => membership.societyId === user.societyId);
  const fallbackMembership = activeMembership || defaultMembership || memberships[0];

  await tx.user.update({
    where: { id: userId },
    data: {
      role: fallbackMembership.role,
      societyId: defaultMembership?.societyId || fallbackMembership.societyId,
      activeSocietyId: activeMembership?.societyId || fallbackMembership.societyId,
      isActive: true,
    },
  });
}

export async function runMemberRemoval(args: MemberRemovalArgs) {
  const result = await prisma.$transaction(async (tx) => {
    await args.removeData(tx);

    let membershipDeleted = false;
    if (args.targetUserId) {
      const membership = await tx.userSocietyMembership.findUnique({
        where: { userId_societyId: { userId: args.targetUserId, societyId: args.societyId } },
        select: { role: true },
      });

      const shouldDeleteMembership = typeof args.deleteMembership === 'function'
        ? await args.deleteMembership(tx)
        : args.deleteMembership ?? true;

      if (membership && shouldDeleteMembership) {
        await tx.userSocietyMembership.delete({
          where: { userId_societyId: { userId: args.targetUserId, societyId: args.societyId } },
        });
        await tx.pushNotificationDevice.deleteMany({
          where: { userId: args.targetUserId, societyId: args.societyId },
        });
        await syncUserMembershipState(tx, args.targetUserId);
        membershipDeleted = true;
      }
    }

    await tx.memberRemovalAudit.create({
      data: {
        societyId: args.societyId,
        targetUserId: args.targetUserId || null,
        targetRole: args.targetRole,
        deletedByUserId: args.removedByUserId,
        deletedByRole: args.removedByRole,
        reason: args.reason,
        source: args.source,
        ownerId: args.ownerId || null,
        tenantId: args.tenantId || null,
        flatId: args.flatId || null,
        snapshot: args.snapshot ? JSON.stringify(args.snapshot) : null,
      },
    });

    return { membershipDeleted };
  });

  if (args.targetUserId) {
    invalidateAuthCache(args.targetUserId);
  }

  if (args.recipientEmail) {
    sendMemberRemovalEmail(args.recipientEmail, {
      userName: args.recipientName || 'Member',
      societyName: args.societyName,
      removedRole: args.targetRole,
      reason: args.reason,
    }).catch((error: any) => {
      logger.error('Member removal email failed (non-blocking)', {
        to: args.recipientEmail,
        societyId: args.societyId,
        targetUserId: args.targetUserId,
        error: error.message,
      });
    });
  }

  return result;
}