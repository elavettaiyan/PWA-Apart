import prisma from '../../config/database';

export const COMMUNITY_READ_ITEM_TYPES = {
  APPROVAL: 'APPROVAL',
  DELIVERY: 'DELIVERY',
  SURVEY: 'SURVEY',
} as const;

export type CommunityReadItemType = typeof COMMUNITY_READ_ITEM_TYPES[keyof typeof COMMUNITY_READ_ITEM_TYPES];

export async function getCommunityItemReadStateMap(args: {
  itemType: CommunityReadItemType;
  userId: string;
  itemIds: string[];
}) {
  if (args.itemIds.length === 0) {
    return new Map<string, Date>();
  }

  const readStates = await prisma.communityItemReadState.findMany({
    where: {
      itemType: args.itemType,
      userId: args.userId,
      itemId: { in: args.itemIds },
    },
    select: {
      itemId: true,
      readAt: true,
    },
  });

  const readStateMap = new Map<string, Date>();

  for (const state of readStates) {
    readStateMap.set(state.itemId, state.readAt);
  }

  return readStateMap;
}

export async function setCommunityItemReadState(args: {
  itemType: CommunityReadItemType;
  itemId: string;
  userId: string;
  isRead: boolean;
}) {
  if (args.isRead) {
    return prisma.communityItemReadState.upsert({
      where: {
        itemType_itemId_userId: {
          itemType: args.itemType,
          itemId: args.itemId,
          userId: args.userId,
        },
      },
      update: { readAt: new Date() },
      create: {
        itemType: args.itemType,
        itemId: args.itemId,
        userId: args.userId,
        readAt: new Date(),
      },
    });
  }

  return prisma.communityItemReadState.deleteMany({
    where: {
      itemType: args.itemType,
      itemId: args.itemId,
      userId: args.userId,
    },
  });
}
