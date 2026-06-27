import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { deleteSocietyById, findSocietyForDeletion, getAllSocietiesForAdmin, getAllUsersForAdmin } from './service';
import { deleteSocietyValidation } from './validation';

const router = Router();

router.use(authenticate);
router.use(authorize('SUPER_ADMIN'));

// ── ALL USER REGISTRATIONS (SUPER_ADMIN) ───────────────
router.get('/users', async (_req: AuthRequest, res: Response) => {
  try {
    const users = await getAllUsersForAdmin();

    return res.json(users);
  } catch (_error) {
    return res.status(500).json({ error: 'Failed to fetch user registrations' });
  }
});

// ── ALL SOCIETIES (SUPER_ADMIN) ────────────────────────
router.get('/societies', async (_req: AuthRequest, res: Response) => {
  try {
    const societies = await getAllSocietiesForAdmin();

    return res.json(societies);
  } catch (_error) {
    return res.status(500).json({ error: 'Failed to fetch societies' });
  }
});

// ── DELETE ENTIRE SOCIETY (SUPER_ADMIN) ────────────────
router.delete(  '/societies/:id',
  deleteSocietyValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const society = await findSocietyForDeletion(req.params.id);
      if (!society) return res.status(404).json({ error: 'Society not found' });

      if (req.body.confirmationName !== society.name) {
        return res.status(400).json({ error: 'Confirmation name does not match society name' });
      }

      if (req.user?.societyId === society.id) {
        return res.status(409).json({
          error: 'Cannot delete the society linked to your own super admin account',
        });
      }

      await deleteSocietyById(society.id);
      return res.json({ message: 'Society and all related apartment data deleted successfully' });
    } catch (_error) {
      return res.status(500).json({ error: 'Failed to delete society' });
    }
  },
);

export default router;
