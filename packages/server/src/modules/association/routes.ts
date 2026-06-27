import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest, SOCIETY_MANAGERS } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { sendCreated, sendOk } from '../../lib/http';
import { canAccessBylaw } from './permissions';
import { createBylawValidation, bylawIdValidation } from './validation';
import { createBylaw, deactivateBylaw, findBylawById, listActiveBylaws, updateBylaw } from './service';

const router = Router();
router.use(authenticate);

// ── GET ALL BYLAWS ──────────────────────────────────────
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const result = await listActiveBylaws(req.user!.societyId);

    return sendOk(res, result);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch bylaws' });
  }
});

// ── GET SINGLE BYLAW ────────────────────────────────────
router.get('/:id', bylawIdValidation, validate, async (req: AuthRequest, res: Response) => {
  try {
    const bylaw = await findBylawById(req.params.id);
    if (!bylaw) return res.status(404).json({ error: 'Bylaw not found' });

    if (!canAccessBylaw(req.user!, bylaw)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return sendOk(res, bylaw);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch bylaw' });
  }
});

// ── CREATE BYLAW ────────────────────────────────────────
router.post(
  '/',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  createBylawValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const bylaw = await createBylaw(req.user!.societyId!, req.body);

      return sendCreated(res, bylaw);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create bylaw' });
    }
  },
);

// ── UPDATE BYLAW ────────────────────────────────────────
router.put(
  '/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  bylawIdValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const existing = await findBylawById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Bylaw not found' });
      if (!canAccessBylaw(req.user!, existing)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const bylaw = await updateBylaw(req.params.id, req.body);
      return sendOk(res, bylaw);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update bylaw' });
    }
  },
);

// ── DELETE (DEACTIVATE) BYLAW ───────────────────────────
router.delete(
  '/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  bylawIdValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const existing = await findBylawById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Bylaw not found' });
      if (!canAccessBylaw(req.user!, existing)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      await deactivateBylaw(req.params.id);
      return sendOk(res, { message: 'Bylaw deactivated successfully' });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to deactivate bylaw' });
    }
  },
);

export default router;
