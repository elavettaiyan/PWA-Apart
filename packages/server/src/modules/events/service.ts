import prisma from '../../config/database';
import { notifyEventCancelled, notifyEventCreated, notifyEventUpdated, sendDueEventReminders } from '../notifications/service';

export function parseImages(value?: string | null) {
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

export function parseReminderMinutes(value: unknown) {
  const normalize = (items: unknown[]) => {
    const numbers = items
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item >= 5 && item <= 7 * 24 * 60);
    return [...new Set(numbers)].sort((left, right) => right - left);
  };

  if (Array.isArray(value)) {
    return normalize(value);
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    return [] as number[];
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

export function mapEvent(record: any) {
  return {
    id: record.id,
    societyId: record.societyId,
    createdById: record.createdById,
    title: record.title,
    description: record.description,
    place: record.place,
    startAt: record.startAt,
    endAt: record.endAt,
    status: record.status,
    imageUrls: parseImages(record.imageUrls),
    reminderMinutes: parseReminderMinutes(record.reminderMinutes),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    createdBy: record.createdBy ? {
      id: record.createdBy.id,
      name: record.createdBy.name,
      role: record.createdBy.role,
    } : undefined,
  };
}

const eventInclude = {
  createdBy: { select: { id: true, name: true, role: true } },
} as const;

export const listEvents = async (societyId: string, status?: string) => {
  const events = await prisma.societyEvent.findMany({
    where: {
      societyId,
      ...(status ? { status: status as any } : {}),
    },
    include: eventInclude,
    orderBy: [{ startAt: 'asc' }, { createdAt: 'desc' }],
  });

  return events.map(mapEvent);
};

export const hasInvalidEventEndTime = (startAt: Date | undefined, endAt: Date | null | undefined) => {
  return Boolean(startAt && endAt && endAt < startAt);
};

export const createEvent = async (params: {
  societyId: string;
  createdById: string;
  body: Record<string, any>;
  imageUrls: string[];
}) => {
  const startAt = new Date(params.body.startAt);
  const endAt = params.body.endAt ? new Date(params.body.endAt) : null;
  const reminderMinutes = parseReminderMinutes(params.body.reminderMinutes);

  const event = await prisma.societyEvent.create({
    data: {
      societyId: params.societyId,
      createdById: params.createdById,
      title: params.body.title,
      description: params.body.description,
      place: params.body.place,
      startAt,
      endAt,
      imageUrls: params.imageUrls.length > 0 ? JSON.stringify(params.imageUrls) : null,
      reminderMinutes: reminderMinutes.length > 0 ? JSON.stringify(reminderMinutes) : null,
    },
    include: eventInclude,
  });

  const notification = await notifyEventCreated(event.id);
  return {
    ...mapEvent(event),
    push: {
      sentCount: notification.sentCount,
      failedCount: notification.failedCount,
      configured: notification.configured,
    },
  };
};

export const findEventInSociety = (id: string, societyId: string) => {
  return prisma.societyEvent.findFirst({
    where: { id, societyId },
    select: { id: true, imageUrls: true },
  });
};

export const updateEvent = async (params: {
  id: string;
  body: Record<string, any>;
  imageUrls: string[];
}) => {
  const startAt = params.body.startAt ? new Date(params.body.startAt) : undefined;
  const endAt = params.body.endAt ? new Date(params.body.endAt) : params.body.endAt === '' ? null : undefined;
  const reminderMinutes = parseReminderMinutes(params.body.reminderMinutes);

  const event = await prisma.societyEvent.update({
    where: { id: params.id },
    data: {
      ...(params.body.title !== undefined ? { title: params.body.title } : {}),
      ...(params.body.description !== undefined ? { description: params.body.description } : {}),
      ...(params.body.place !== undefined ? { place: params.body.place } : {}),
      ...(startAt ? { startAt } : {}),
      ...(endAt !== undefined ? { endAt } : {}),
      ...(params.body.status ? { status: params.body.status } : {}),
      ...(params.imageUrls.length > 0 ? { imageUrls: JSON.stringify(params.imageUrls) } : {}),
      ...(params.body.reminderMinutes !== undefined ? { reminderMinutes: reminderMinutes.length > 0 ? JSON.stringify(reminderMinutes) : null } : {}),
    },
    include: eventInclude,
  });

  const notification = event.status === 'CANCELLED'
    ? await notifyEventCancelled(event.id)
    : await notifyEventUpdated(event.id);

  return {
    ...mapEvent(event),
    push: {
      sentCount: notification.sentCount,
      failedCount: notification.failedCount,
      configured: notification.configured,
    },
  };
};

export const deleteEvent = (id: string) => {
  return prisma.societyEvent.delete({ where: { id } });
};

export const processEventReminders = async (societyId: string | null) => {
  const result = await sendDueEventReminders(societyId || undefined);
  return {
    message: 'Event reminders processed',
    ...result,
  };
};