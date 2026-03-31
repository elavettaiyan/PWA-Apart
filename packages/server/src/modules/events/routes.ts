import { Response, Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest, SOCIETY_MANAGERS } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { getFileUrl, upload } from '../../middleware/upload';
import { notifyEventCancelled, notifyEventCreated, notifyEventUpdated, sendDueEventReminders } from '../notifications/service';

const router = Router();

router.use(authenticate);

function resolveSocietyId(req: AuthRequest, providedSocietyId?: string) {
  if (req.user?.role === 'SUPER_ADMIN') {
    return providedSocietyId || req.user.societyId || null;
  }

  return req.user?.societyId || null;
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

function parseReminderMinutes(value: unknown) {
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

function mapEvent(record: any) {
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

router.get(
  '/',
  [query('societyId').optional().isUUID(), query('status').optional().isIn(['SCHEDULED', 'CANCELLED', 'COMPLETED'])],
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req, req.query.societyId as string | undefined);
    if (!societyId) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const events = await prisma.societyEvent.findMany({
      where: {
        societyId,
        ...(status ? { status: status as any } : {}),
      },
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: [{ startAt: 'asc' }, { createdAt: 'desc' }],
    });

    return res.json(events.map(mapEvent));
  },
);

router.post(
  '/',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  upload.array('images', 4),
  [
    body('societyId').optional().isUUID(),
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('description').trim().notEmpty().withMessage('Description is required'),
    body('place').trim().notEmpty().withMessage('Place is required'),
    body('startAt').isISO8601().withMessage('Valid start date and time is required'),
    body('endAt').optional({ values: 'falsy' }).isISO8601().withMessage('Valid end date and time is required'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req, req.body.societyId);
    if (!societyId) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const startAt = new Date(req.body.startAt);
    const endAt = req.body.endAt ? new Date(req.body.endAt) : null;
    if (endAt && endAt < startAt) {
      return res.status(400).json({ error: 'Event end time cannot be before the start time' });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    const reminderMinutes = parseReminderMinutes(req.body.reminderMinutes);

    const event = await prisma.societyEvent.create({
      data: {
        societyId,
        createdById: req.user!.id,
        title: req.body.title,
        description: req.body.description,
        place: req.body.place,
        startAt,
        endAt,
        imageUrls: files.length > 0 ? JSON.stringify(files.map((file) => getFileUrl(file))) : null,
        reminderMinutes: reminderMinutes.length > 0 ? JSON.stringify(reminderMinutes) : null,
      },
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
      },
    });

    const notification = await notifyEventCreated(event.id);
    return res.status(201).json({
      ...mapEvent(event),
      push: {
        sentCount: notification.sentCount,
        failedCount: notification.failedCount,
        configured: notification.configured,
      },
    });
  },
);

router.patch(
  '/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  upload.array('images', 4),
  [
    param('id').isUUID(),
    body('title').optional().trim().notEmpty(),
    body('description').optional().trim().notEmpty(),
    body('place').optional().trim().notEmpty(),
    body('startAt').optional().isISO8601(),
    body('endAt').optional({ values: 'falsy' }).isISO8601(),
    body('status').optional().isIn(['SCHEDULED', 'CANCELLED', 'COMPLETED']),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const existing = await prisma.societyEvent.findFirst({
      where: { id: req.params.id, societyId },
      select: { id: true, imageUrls: true },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const startAt = req.body.startAt ? new Date(req.body.startAt) : undefined;
    const endAt = req.body.endAt ? new Date(req.body.endAt) : req.body.endAt === '' ? null : undefined;
    if (startAt && endAt && endAt < startAt) {
      return res.status(400).json({ error: 'Event end time cannot be before the start time' });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    const reminderMinutes = parseReminderMinutes(req.body.reminderMinutes);

    const event = await prisma.societyEvent.update({
      where: { id: existing.id },
      data: {
        ...(req.body.title !== undefined ? { title: req.body.title } : {}),
        ...(req.body.description !== undefined ? { description: req.body.description } : {}),
        ...(req.body.place !== undefined ? { place: req.body.place } : {}),
        ...(startAt ? { startAt } : {}),
        ...(endAt !== undefined ? { endAt } : {}),
        ...(req.body.status ? { status: req.body.status } : {}),
        ...(files.length > 0 ? { imageUrls: JSON.stringify(files.map((file) => getFileUrl(file))) } : {}),
        ...(req.body.reminderMinutes !== undefined ? { reminderMinutes: reminderMinutes.length > 0 ? JSON.stringify(reminderMinutes) : null } : {}),
      },
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
      },
    });

    const notification = event.status === 'CANCELLED'
      ? await notifyEventCancelled(event.id)
      : await notifyEventUpdated(event.id);

    return res.json({
      ...mapEvent(event),
      push: {
        sentCount: notification.sentCount,
        failedCount: notification.failedCount,
        configured: notification.configured,
      },
    });
  },
);

router.delete(
  '/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const existing = await prisma.societyEvent.findFirst({
      where: { id: req.params.id, societyId },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Event not found' });
    }

    await prisma.societyEvent.delete({ where: { id: existing.id } });
    return res.json({ message: 'Event deleted successfully' });
  },
);

router.post(
  '/reminders/send',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [body('societyId').optional().isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req, req.body.societyId);
    const result = await sendDueEventReminders(societyId || undefined);
    return res.json({
      message: 'Event reminders processed',
      ...result,
    });
  },
);

export default router;