import prisma from '../../config/database';
import { COMMUNITY_READ_ITEM_TYPES, getCommunityItemReadStateMap, setCommunityItemReadState } from '../communityReadState/service';
import { findFlatInSociety, getFlatResidentName, getOwnedFlatIds, getResidentFlatIds, isResidentRole } from '../entries/utils';

const HIGHER_ROLE_OWNER_VIEW_ROLES = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER'];

const deliveryInclude = {
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

const deliveryReadStateInclude = {
  flat: {
    select: {
      id: true,
      flatNumber: true,
      block: { select: { name: true } },
      owner: { select: { name: true, userId: true } },
      tenant: { select: { name: true, userId: true, isActive: true } },
    },
  },
  capturedBy: { select: { name: true } },
} as const;

export function toDeliveryResponse(delivery: any, readAt?: Date | null) {
  return {
    ...delivery,
    isRead: Boolean(readAt),
    readAt: readAt ? readAt.toISOString() : null,
    flat: delivery.flat
      ? {
          id: delivery.flat.id,
          flatNumber: delivery.flat.flatNumber,
          block: delivery.flat.block,
          residentName: getFlatResidentName(delivery.flat),
        }
      : null,
  };
}

const getVisibleFlatIds = async (params: { userId: string; societyId: string; role: string; ownerViewRequested: boolean }) => {
  const isHigherRoleOwnerView = params.ownerViewRequested && HIGHER_ROLE_OWNER_VIEW_ROLES.includes(params.role);
  const shouldFilterByFlat = isResidentRole(params.role) || isHigherRoleOwnerView;

  if (!shouldFilterByFlat) {
    return { shouldFilterByFlat, flatIds: null as string[] | null };
  }

  const flatIds = isHigherRoleOwnerView
    ? await getOwnedFlatIds(params.userId, params.societyId)
    : await getResidentFlatIds(params.userId, params.societyId);

  return { shouldFilterByFlat, flatIds };
};

export const listDeliveries = async (params: {
  societyId: string;
  userId: string;
  role: string;
  query: Record<string, any>;
}) => {
  const where: any = { societyId: params.societyId };
  if (params.query.deliveryType) where.deliveryType = params.query.deliveryType;

  const { shouldFilterByFlat, flatIds } = await getVisibleFlatIds({
    userId: params.userId,
    societyId: params.societyId,
    role: params.role,
    ownerViewRequested: params.query.ownerView === 'true',
  });

  if (shouldFilterByFlat) {
    if (!flatIds || flatIds.length === 0) return [];

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

  const deliveries = await prisma.delivery.findMany({
    where,
    take,
    orderBy: { deliveredAt: 'desc' },
    include: deliveryInclude,
  });

  const deliveryReadStateMap = await getCommunityItemReadStateMap({
    itemType: COMMUNITY_READ_ITEM_TYPES.DELIVERY,
    userId: params.userId,
    itemIds: deliveries.map((delivery) => delivery.id),
  });

  return deliveries.map((delivery) => toDeliveryResponse(delivery, deliveryReadStateMap.get(delivery.id) || null));
};

export const createDelivery = async (params: {
  societyId: string;
  userId: string;
  body: Record<string, any>;
  photoUrl: string | null;
}) => {
  const flat = await findFlatInSociety(params.body.flatId, params.societyId);
  if (!flat) return null;

  const delivery = await prisma.delivery.create({
    data: {
      societyId: params.societyId,
      flatId: params.body.flatId,
      capturedByUserId: params.userId,
      deliveryType: params.body.deliveryType,
      deliveryPersonName: params.body.deliveryPersonName,
      mobile: params.body.mobile || null,
      companyName: params.body.companyName || null,
      vehicleNumber: params.body.vehicleNumber || null,
      notes: params.body.notes || null,
      photoUrl: params.photoUrl,
    },
    include: deliveryInclude,
  });

  return toDeliveryResponse(delivery, null);
};

export const findDeliveryForReadState = (id: string, societyId: string) => {
  return prisma.delivery.findFirst({
    where: {
      id,
      societyId,
    },
    include: deliveryReadStateInclude,
  });
};

export const canReadDelivery = async (params: {
  userId: string;
  societyId: string;
  role: string;
  deliveryFlatId: string;
  ownerViewRequested: boolean;
}) => {
  const { shouldFilterByFlat, flatIds } = await getVisibleFlatIds(params);

  if (!shouldFilterByFlat) {
    return true;
  }

  return Boolean(flatIds?.includes(params.deliveryFlatId));
};

export const updateDeliveryReadState = async (params: {
  delivery: any;
  userId: string;
  isRead: boolean;
}) => {
  await setCommunityItemReadState({
    itemType: COMMUNITY_READ_ITEM_TYPES.DELIVERY,
    itemId: params.delivery.id,
    userId: params.userId,
    isRead: params.isRead,
  });

  const readStateMap = await getCommunityItemReadStateMap({
    itemType: COMMUNITY_READ_ITEM_TYPES.DELIVERY,
    userId: params.userId,
    itemIds: [params.delivery.id],
  });

  return toDeliveryResponse(params.delivery, readStateMap.get(params.delivery.id) || null);
};