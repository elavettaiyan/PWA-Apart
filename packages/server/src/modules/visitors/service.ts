import prisma from '../../config/database';
import { findFlatInSociety, getFlatResidentName, getOwnedFlatIds, getResidentFlatIds, isResidentRole } from '../entries/utils';

const HIGHER_ROLE_OWNER_VIEW_ROLES = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER'];

const visitorInclude = {
  flat: {
    select: {
      id: true,
      flatNumber: true,
      block: { select: { name: true } },
      owner: { select: { name: true } },
      tenant: { select: { name: true, isActive: true } },
    },
  },
  capturedBy: { select: { name: true } },
} as const;

export function toVisitorResponse(visitor: any) {
  return {
    ...visitor,
    flat: visitor.flat
      ? {
          id: visitor.flat.id,
          flatNumber: visitor.flat.flatNumber,
          block: visitor.flat.block,
          residentName: getFlatResidentName(visitor.flat),
        }
      : null,
  };
}

export const listVisitors = async (params: {
  societyId: string;
  userId: string;
  role: string;
  query: Record<string, any>;
}) => {
  const where: any = { societyId: params.societyId };
  if (params.query.status) where.status = params.query.status;

  const ownerViewRequested = params.query.ownerView === 'true';
  const isHigherRoleOwnerView = ownerViewRequested && HIGHER_ROLE_OWNER_VIEW_ROLES.includes(params.role);
  const shouldFilterByFlat = isResidentRole(params.role) || isHigherRoleOwnerView;

  if (shouldFilterByFlat) {
    const flatIds = isHigherRoleOwnerView
      ? await getOwnedFlatIds(params.userId, params.societyId)
      : await getResidentFlatIds(params.userId, params.societyId);
    if (flatIds.length === 0) return [];

    where.flatId = params.query.flatId
      ? flatIds.includes(params.query.flatId as string)
        ? params.query.flatId
        : '__forbidden__'
      : { in: flatIds };
  } else if (params.query.flatId) {
    where.flatId = params.query.flatId;
  }

  if (where.flatId === '__forbidden__') {
    return [];
  }

  const take = Number(params.query.limit || (shouldFilterByFlat ? 5 : 20));

  const visitors = await prisma.visitor.findMany({
    where,
    take,
    orderBy: { checkedInAt: 'desc' },
    include: visitorInclude,
  });

  return visitors.map(toVisitorResponse);
};

export const createVisitor = async (params: {
  societyId: string;
  userId: string;
  body: Record<string, any>;
  photoUrl: string | null;
}) => {
  const flat = await findFlatInSociety(params.body.flatId, params.societyId);
  if (!flat) return null;

  const visitor = await prisma.visitor.create({
    data: {
      societyId: params.societyId,
      flatId: params.body.flatId,
      capturedByUserId: params.userId,
      visitorName: params.body.visitorName,
      mobile: params.body.mobile,
      vehicleNumber: params.body.vehicleNumber || null,
      purpose: params.body.purpose,
      notes: params.body.notes || null,
      photoUrl: params.photoUrl,
    },
    include: visitorInclude,
  });

  return toVisitorResponse(visitor);
};

export const findVisitorInSociety = (id: string, societyId: string) => {
  return prisma.visitor.findFirst({
    where: { id, societyId },
  });
};

export const checkoutVisitor = async (id: string, checkedOutAt?: string) => {
  const visitor = await prisma.visitor.update({
    where: { id },
    data: {
      status: 'LEFT',
      checkedOutAt: checkedOutAt ? new Date(checkedOutAt) : new Date(),
    },
    include: visitorInclude,
  });

  return toVisitorResponse(visitor);
};