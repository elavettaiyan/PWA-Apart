import { Response, Router } from 'express';
import { body } from 'express-validator';
import { authenticate, authorize, AuthRequest, FINANCIAL_ROLES, SOCIETY_MANAGERS } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { sendAnnouncementBroadcast, sendMaintenanceDueReminders } from './service';

const router = Router();
router.use(authenticate);

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