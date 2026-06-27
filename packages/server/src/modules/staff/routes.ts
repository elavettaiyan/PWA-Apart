import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest, SOCIETY_ADMINS } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { sendCreated, sendOk } from '../../lib/http';
import { getRequiredSocietyId } from './permissions';
import { createOrLinkStaff, findStaffMembership, listStaffBySociety, updateStaff } from './service';
import { createStaffValidation, updateStaffValidation } from './validation';

const router = Router();
router.use(authenticate);
router.use(authorize('SUPER_ADMIN', ...SOCIETY_ADMINS));

// ── GET ALL STAFF IN SOCIETY ────────────────────────────
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const societyId = getRequiredSocietyId(req);
    if (!societyId) return res.status(400).json({ error: 'Society ID required' });

    const staff = await listStaffBySociety(societyId);

    return sendOk(res, staff);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch staff' });
  }
});

// ── CREATE STAFF MEMBER ─────────────────────────────────
router.post(
  '/',
  createStaffValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = getRequiredSocietyId(req);
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const result = await createOrLinkStaff(societyId, req.body);
      return result.statusCode === 201
        ? sendCreated(res, result.body)
        : res.status(result.statusCode).json(result.body);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create staff member' });
    }
  },
);

// ── UPDATE STAFF MEMBER ─────────────────────────────────
router.patch(
  '/:id',
  updateStaffValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = getRequiredSocietyId(req);
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const membership = await findStaffMembership(societyId, req.params.id);
      if (!membership) return res.status(404).json({ error: 'Staff member not found in your society' });

      const user = await updateStaff(req.params.id, req.body);

      return sendOk(res, user);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update staff member' });
    }
  },
);

export default router;
