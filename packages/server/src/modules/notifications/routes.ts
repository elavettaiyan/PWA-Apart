import { Response, Router } from 'express';
import { body, query } from 'express-validator';
import { authenticate, authorize, AuthRequest, FINANCIAL_ROLES, SOCIETY_MANAGERS } from '../../middleware/auth';
import prisma from '../../config/database';
import { validate } from '../../middleware/errorHandler';
import { sendAnnouncementBroadcast, sendMaintenanceDueReminders } from './service';

const router = Router();
router.use(authenticate);

function buildNotificationKey(notification: {
  type: string;
  title: string;
  body: string;
  path: string | null;
  route: string | null;
  entityId: string | null;
}) {
  return [
    notification.type,
    notification.title,
    notification.body,
    notification.path || '',
    notification.route || '',
    notification.entityId || '',
  ].join('::');
}

function serializeNotification(notification: {
  id: string;
  type: string;
  title: string;
  body: string;
  path: string | null;
  route: string | null;
  entityId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...notification,
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString(),
  };
}

router.get(
  '/',
  [
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = req.user?.societyId;
    if (!societyId) {
      return res.json([]);
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const fetchLimit = Math.min(limit * 5, 250);

    const notifications = await prisma.userNotification.findMany({
      where: {
        societyId,
      },
      orderBy: { createdAt: 'desc' },
      take: fetchLimit,
    });

    const uniqueNotifications = [] as typeof notifications;
    const seenKeys = new Set<string>();

    for (const notification of notifications) {
      const key = buildNotificationKey(notification);
      if (seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);
      uniqueNotifications.push(notification);

      if (uniqueNotifications.length >= limit) {
        break;
      }
    }

    return res.json(uniqueNotifications.map(serializeNotification));
  },
);

router.post(
  '/maintenance-reminders/send',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  [
    body('societyId').optional().isUUID(),
    body('dueInDays').optional().isInt({ min: 0, max: 30 }),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = req.user!.role === 'SUPER_ADMIN'
      ? req.body.societyId || req.user!.societyId
      : req.user!.societyId;

    if (!societyId) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const result = await sendMaintenanceDueReminders(societyId, Number(req.body.dueInDays || 3));
    return res.json({
      message: 'Maintenance reminders processed',
      ...result,
    });
  },
);

router.post(
  '/announcements/broadcast',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [
    body('societyId').optional().isUUID(),
    body('title').isString().trim().notEmpty(),
    body('message').isString().trim().notEmpty(),
    body('path').optional().isString(),
    body('roles').optional().isArray(),
    body('roles.*').optional().isIn(['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER', 'OWNER', 'TENANT', 'SERVICE_STAFF']),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = req.user!.role === 'SUPER_ADMIN'
      ? req.body.societyId || req.user!.societyId
      : req.user!.societyId;

    if (!societyId) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const result = await sendAnnouncementBroadcast({
      societyId,
      createdById: req.user!.id,
      title: req.body.title,
      message: req.body.message,
      path: req.body.path,
      roles: req.body.roles,
    });

    return res.status(201).json({
      message: 'Announcement broadcast processed',
      ...result,
    });
  },
);

export default router;