import { Response, Router } from 'express';
import { authenticate, authorize, AuthRequest, SOCIETY_MANAGERS } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { getFileUrl, upload } from '../../middleware/upload';
import { sendCreated, sendOk } from '../../lib/http';
import { resolveSocietyId } from './permissions';
import { createEvent, deleteEvent, findEventInSociety, hasInvalidEventEndTime, listEvents, processEventReminders, updateEvent } from './service';
import { createEventValidation, eventIdValidation, listEventsValidation, sendEventRemindersValidation, updateEventValidation } from './validation';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  listEventsValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req, req.query.societyId as string | undefined);
    if (!societyId) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const events = await listEvents(societyId, status);

    return sendOk(res, events);
  },
);

router.post(
  '/',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  upload.array('images', 4),
  createEventValidation,
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
    const event = await createEvent({
      societyId,
      createdById: req.user!.id,
      body: req.body,
      imageUrls: files.map((file) => getFileUrl(file)),
    });

    return sendCreated(res, event);
  },
);

router.patch(
  '/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  upload.array('images', 4),
  updateEventValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const existing = await findEventInSociety(req.params.id, societyId);

    if (!existing) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const startAt = req.body.startAt ? new Date(req.body.startAt) : undefined;
    const endAt = req.body.endAt ? new Date(req.body.endAt) : req.body.endAt === '' ? null : undefined;
    if (hasInvalidEventEndTime(startAt, endAt)) {
      return res.status(400).json({ error: 'Event end time cannot be before the start time' });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    const event = await updateEvent({
      id: existing.id,
      body: req.body,
      imageUrls: files.map((file) => getFileUrl(file)),
    });

    return sendOk(res, event);
  },
);

router.delete(
  '/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  eventIdValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const existing = await findEventInSociety(req.params.id, societyId);

    if (!existing) {
      return res.status(404).json({ error: 'Event not found' });
    }

    await deleteEvent(existing.id);
    return sendOk(res, { message: 'Event deleted successfully' });
  },
);

router.post(
  '/reminders/send',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  sendEventRemindersValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req, req.body.societyId);
    const result = await processEventReminders(societyId);
    return sendOk(res, result);
  },
);

export default router;