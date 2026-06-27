import { Response, Router } from 'express';
import { authenticate, authorize, AuthRequest, FINANCIAL_ROLES, SOCIETY_MANAGERS } from '../../middleware/auth';
import logger from '../../config/logger';
import { validate } from '../../middleware/errorHandler';
import { sendCreated, sendOk } from '../../lib/http';
import { resolveNotificationSocietyId } from './permissions';
import { listRecentUserNotifications, sendAnnouncementBroadcast, sendMaintenanceDueReminders } from './service';
import {
  announcementBroadcastValidation,
  maintenanceReminderValidation,
  recentNotificationsValidation,
} from './validation';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  recentNotificationsValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user?.activeSocietyId || req.user?.societyId;
      const userId = req.user?.id;
      return sendOk(res, await listRecentUserNotifications({ societyId, userId, limit: req.query.limit }));
    } catch (error: any) {
      logger.error('Failed to fetch recent notifications', {
        error: error?.message,
        societyId: req.user?.societyId,
        userId: req.user?.id,
      });
      return res.json([]);
    }
  },
);

router.post(
  '/maintenance-reminders/send',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  maintenanceReminderValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveNotificationSocietyId(req);

    if (!societyId) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const result = await sendMaintenanceDueReminders(societyId, Number(req.body.dueInDays || 3));
    return sendOk(res, {
      message: 'Maintenance reminders processed',
      ...result,
    });
  },
);

router.post(
  '/announcements/broadcast',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  announcementBroadcastValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveNotificationSocietyId(req);

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

    return sendCreated(res, {
      message: 'Announcement broadcast processed',
      ...result,
    });
  },
);

export default router;