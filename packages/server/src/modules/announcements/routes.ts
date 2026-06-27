import { Response, Router } from 'express';
import logger from '../../config/logger';
import { authenticate, authorize, AuthRequest, SOCIETY_MANAGERS } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { getFileUrl, upload } from '../../middleware/upload';
import { sendCreated, sendOk } from '../../lib/http';
import { resolveSocietyId } from './permissions';
import { createAnnouncement, deleteAnnouncement, findAnnouncementInSociety, listAnnouncements, parseRoles, pinAnnouncement, updateAnnouncementReadState } from './service';
import { announcementIdValidation, announcementReadStateValidation, createAnnouncementValidation, listAnnouncementsValidation, pinAnnouncementValidation } from './validation';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  listAnnouncementsValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req, req.query.societyId as string | undefined);
    if (!societyId) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const announcements = await listAnnouncements(societyId, req.user?.id);

    return sendOk(res, announcements);
  },
);

router.post(
  '/',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  upload.array('images', 4),
  createAnnouncementValidation,
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

      const announcement = await createAnnouncement({
        societyId,
        createdById: req.user!.id,
        title: req.body.title,
        message: req.body.message,
        images,
        path: req.body.path || '/community?tab=announcements',
        roles,
      });

      return sendCreated(res, announcement);
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
  announcementIdValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const announcement = await findAnnouncementInSociety(req.params.id, societyId);

    if (!announcement) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    await deleteAnnouncement(announcement.id);
    return sendOk(res, { message: 'Announcement deleted successfully' });
  },
);

router.patch(
  '/:id/pin',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  pinAnnouncementValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const announcement = await findAnnouncementInSociety(req.params.id, societyId);

    if (!announcement) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    const updatedAnnouncement = await pinAnnouncement(announcement.id, req.body.isPinned, req.user?.id);

    return sendOk(res, updatedAnnouncement);
  },
);

router.patch(
  '/:id/read-state',
  announcementReadStateValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req);
    if (!societyId || !req.user?.id) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const announcement = await findAnnouncementInSociety(req.params.id, societyId);

    if (!announcement) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    const updatedAnnouncement = await updateAnnouncementReadState(announcement.id, req.user.id, req.body.isRead);

    return sendOk(res, updatedAnnouncement);
  },
);

export default router;