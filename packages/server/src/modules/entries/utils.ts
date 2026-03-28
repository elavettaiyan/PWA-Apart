import prisma from '../../config/database';

export const ENTRY_ACCESS_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'SERVICE_STAFF', 'OWNER', 'TENANT'] as const;
export const ENTRY_MANAGE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'SERVICE_STAFF'] as const;

export function isResidentRole(role: string) {
  return role === 'OWNER' || role === 'TENANT';
}

export async function getResidentFlatIds(userId: string, societyId: string) {
  const [owners, tenants] = await Promise.all([
    prisma.owner.findMany({
      where: { userId, flat: { block: { societyId } } },
      select: { flatId: true },
    }),
    prisma.tenant.findMany({
      where: { userId, flat: { block: { societyId } } },
      select: { flatId: true },
    }),
  ]);

  return [...new Set([...owners.map((owner) => owner.flatId), ...tenants.map((tenant) => tenant.flatId)])];
}

export async function findFlatInSociety(flatId: string, societyId: string) {
  return prisma.flat.findFirst({
    where: {
      id: flatId,
      block: { societyId },
    },
    select: {
      id: true,
      flatNumber: true,
      block: { select: { name: true } },
      owner: { select: { name: true } },
      tenant: { select: { name: true, isActive: true } },
    },
  });
}

export function getFlatResidentName(flat: {
  owner: { name: string } | null;
  tenant: { name: string; isActive: boolean } | null;
}) {
  if (flat.tenant?.isActive) {
    return flat.tenant.name;
  }

  return flat.owner?.name || null;
}