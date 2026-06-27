import { Response, Router } from 'express';
import { authenticate, authorize, AuthRequest } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { getFileUrl, upload } from '../../middleware/upload';
import { sendCreated, sendOk } from '../../lib/http';
import { ENTRY_ACCESS_ROLES, ENTRY_MANAGE_ROLES } from '../entries/utils';
import { notifyVisitorEntry } from '../notifications/service';
import { checkoutVisitor, createVisitor, findVisitorInSociety, listVisitors } from './service';
import { checkoutVisitorValidation, createVisitorValidation, listVisitorsValidation } from './validation';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  authorize(...ENTRY_ACCESS_ROLES),
  listVisitorsValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.societyId;
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const visitors = await listVisitors({
        societyId,
        userId: req.user!.id,
        role: req.user!.role,
        query: req.query,
      });

      return sendOk(res, visitors);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch visitors' });
    }
  },
);

router.post(
  '/',
  authorize(...ENTRY_MANAGE_ROLES),
  upload.single('photo'),
  createVisitorValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.societyId;
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const visitor = await createVisitor({
        societyId,
        userId: req.user!.id,
        body: req.body,
        photoUrl: req.file ? getFileUrl(req.file) : null,
      });
      if (!visitor) return res.status(404).json({ error: 'Flat not found in your society' });

      notifyVisitorEntry(visitor.id).catch(() => {});

      return sendCreated(res, visitor);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create visitor' });
    }
  },
);

router.patch(
  '/:id/checkout',
  authorize(...ENTRY_MANAGE_ROLES),
  checkoutVisitorValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.societyId;
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const existing = await findVisitorInSociety(req.params.id, societyId);

      if (!existing) return res.status(404).json({ error: 'Visitor not found' });
      if (existing.status === 'LEFT') return res.status(400).json({ error: 'Visitor already marked as left' });

      const visitor = await checkoutVisitor(req.params.id, req.body.checkedOutAt);

      return sendOk(res, visitor);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update visitor status' });
    }
  },
);

export default router;