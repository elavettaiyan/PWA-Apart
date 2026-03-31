import { Response, Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/database';
import logger from '../../config/logger';
import { authenticate, authorize, AuthRequest, SOCIETY_MANAGERS } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { getFileUrl, upload } from '../../middleware/upload';
import { DEFAULT_COMMUNITY_AUDIENCE_ROLES, sendAnnouncementBroadcast } from '../notifications/service';

const router = Router();

router.use(authenticate);

function resolveSocietyId(req: AuthRequest, providedSocietyId?: string) {
  if (req.user?.role === 'SUPER_ADMIN') {
    return providedSocietyId || req.user.societyId || null;
  }

  return req.user?.societyId || null;
}

function parseRoles(value: unknown) {
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

function mapAnnouncement(record: any) {
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
  [query('societyId').optional().isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req, req.query.societyId as string | undefined);
    if (!societyId) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const announcements = await prisma.announcementBroadcast.findMany({
      where: { societyId },
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(announcements.map(mapAnnouncement));
  },
);

router.post(
  '/',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  upload.array('images', 4),
  [
    body('societyId').optional().isUUID(),
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('message').trim().notEmpty().withMessage('Message is required'),
    body('path').optional({ values: 'falsy' }).isString(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = resolveSocietyId(req, req.body.societyId);
      if (!societyId) {
        return res.status(400).json({ error: 'Society ID required' });
      }

      const files = Array.isArray(req.files) ? req.files : [];
      const images = files.map((file) => getFileUrl(file));
      const roles = parseRoles(req.body.roles);

      logger.info('Announcement create request received', {
        userId: req.user?.id,
        userRole: req.user?.role,
        societyId,
        origin: req.get('origin') || null,
        referer: req.get('referer') || null,
        contentType: req.get('content-type') || null,
        body: {
          title: req.body.title,
          messageLength: typeof req.body.message === 'string' ? req.body.message.length : 0,
          path: req.body.path || null,
          requestedSocietyId: req.body.societyId || null,
          rawRoles: req.body.roles ?? null,
          parsedRoles: roles,
        },
        files: files.map((file) => ({
          fieldname: file.fieldname,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
        })),
      });

      const result = await sendAnnouncementBroadcast({
        societyId,
        createdById: req.user!.id,
        title: req.body.title,
        message: req.body.message,
        images,
        path: req.body.path || '/announcements',
        roles,
      });

      const announcement = await prisma.announcementBroadcast.findUnique({
        where: { id: result.broadcastId },
        include: {
          createdBy: { select: { id: true, name: true, role: true } },
        },
      });

      return res.status(201).json({
        ...mapAnnouncement(announcement),
        push: {
          sentCount: result.sentCount,
          failedCount: result.failedCount,
          configured: result.configured,
        },
      });
    } catch (error: any) {
      logger.error('Announcement create request failed', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        userRole: req.user?.role,
        requestedSocietyId: req.body?.societyId || null,
        title: req.body?.title || null,
      });
      return res.status(500).json({ error: 'Failed to create announcement' });
    }
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

    const announcement = await prisma.announcementBroadcast.findFirst({
      where: { id: req.params.id, societyId },
      select: { id: true },
    });

    if (!announcement) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    await prisma.announcementBroadcast.delete({ where: { id: announcement.id } });
    return res.json({ message: 'Announcement deleted successfully' });
  },
);

export default router;