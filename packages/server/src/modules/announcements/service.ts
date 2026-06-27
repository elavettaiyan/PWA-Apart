import prisma from '../../config/database';
import { DEFAULT_COMMUNITY_AUDIENCE_ROLES, sendAnnouncementBroadcast } from '../notifications/service';

export function parseRoles(value: unknown) {
  const allowedRoles = new Set(DEFAULT_COMMUNITY_AUDIENCE_ROLES as readonly string[]);

  const normalize = (roles: unknown[]) => {
    const filtered = roles.filter((role): role is string => typeof role === 'string' && allowedRoles.has(role));
    return [...new Set(filtered)];
  };

  if (Array.isArray(value)) {
    return normalize(value);
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return normalize(parsed);
    }
  } catch {
    return normalize(value.split(',').map((item) => item.trim()));
  }

  return [];
}

function parseImages(value?: string | null) {
  if (!value) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
  } catch {
    return [];
  }
}

export function mapAnnouncement(record: any) {
  const readAt = Array.isArray(record.readStates) && record.readStates.length > 0
    ? record.readStates[0]?.readAt || null
    : null;

  return {
    id: record.id,
    societyId: record.societyId,
    createdById: record.createdById,
    title: record.title,
    message: record.message,
    path: record.path,
    images: parseImages(record.images),
    targetRoles: parseRoles(record.targetRoles),
    sentCount: record.sentCount,
    isPinned: Boolean(record.isPinned),
    pinnedAt: record.pinnedAt,
    isRead: Boolean(readAt),
    readAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    createdBy: record.createdBy ? {
      id: record.createdBy.id,
      name: record.createdBy.name,
      role: record.createdBy.role,
    } : undefined,
  };
}

const announcementInclude = (userId?: string) => ({
  createdBy: { select: { id: true, name: true, role: true } },
  readStates: userId
    ? {
        where: { userId },
        select: { readAt: true },
        take: 1,
      }
    : false,
});

export const listAnnouncements = async (societyId: string, userId?: string) => {
  const announcements = await prisma.announcementBroadcast.findMany({
    where: { societyId },
    include: announcementInclude(userId),
    orderBy: [{ isPinned: 'desc' }, { pinnedAt: 'desc' }, { createdAt: 'desc' }],
  });

  return announcements.map(mapAnnouncement);
};

export const createAnnouncement = async (params: {
  societyId: string;
  createdById: string;
  title: string;
  message: string;
  images: string[];
  path: string;
  roles: string[];
}) => {
  const result = await sendAnnouncementBroadcast(params);

  const announcement = await prisma.announcementBroadcast.findUnique({
    where: { id: result.broadcastId },
    include: {
      createdBy: { select: { id: true, name: true, role: true } },
    },
  });

  return {
    ...mapAnnouncement(announcement),
    push: {
      sentCount: result.sentCount,
      failedCount: result.failedCount,
      configured: result.configured,
    },
  };
};

export const findAnnouncementInSociety = (id: string, societyId: string) => {
  return prisma.announcementBroadcast.findFirst({
    where: { id, societyId },
    select: { id: true },
  });
};

export const deleteAnnouncement = (id: string) => {
  return prisma.announcementBroadcast.delete({ where: { id } });
};

export const pinAnnouncement = async (id: string, isPinned: boolean, userId?: string) => {
  const updatedAnnouncement = await prisma.announcementBroadcast.update({
    where: { id },
    data: {
      isPinned,
      pinnedAt: isPinned ? new Date() : null,
    },
    include: announcementInclude(userId),
  });

  return mapAnnouncement(updatedAnnouncement);
};

export const updateAnnouncementReadState = async (announcementId: string, userId: string, isRead: boolean) => {
  if (isRead) {
    await prisma.announcementReadState.upsert({
      where: {
        announcementId_userId: {
          announcementId,
          userId,
        },
      },
      update: { readAt: new Date() },
      create: {
        announcementId,
        userId,
        readAt: new Date(),
      },
    });
  } else {
    await prisma.announcementReadState.deleteMany({
      where: {
        announcementId,
        userId,
      },
    });
  }

  const updatedAnnouncement = await prisma.announcementBroadcast.findUnique({
    where: { id: announcementId },
    include: announcementInclude(userId),
  });

  return mapAnnouncement(updatedAnnouncement);
};