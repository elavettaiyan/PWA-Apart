import { Router, Response } from 'express';
import { body, param } from 'express-validator';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';

const router = Router();
router.use(authenticate);

// ── GET ALL BYLAWS ──────────────────────────────────────
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const where: any = { isActive: true };
    if (req.user!.societyId) where.societyId = req.user!.societyId;

    const bylaws = await prisma.associationBylaw.findMany({
      where,
      orderBy: [{ category: 'asc' }, { title: 'asc' }],
    });

    // Group by category
    const grouped = bylaws.reduce((acc: Record<string, any[]>, bylaw) => {
      if (!acc[bylaw.category]) acc[bylaw.category] = [];
      acc[bylaw.category].push(bylaw);
      return acc;
    }, {});

    return res.json({ bylaws, grouped });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch bylaws' });
  }
});

// ── GET SINGLE BYLAW ────────────────────────────────────
router.get('/:id', [param('id').isUUID()], validate, async (req: AuthRequest, res: Response) => {
  try {
    const bylaw = await prisma.associationBylaw.findUnique({
      where: { id: req.params.id },
    });
    if (!bylaw) return res.status(404).json({ error: 'Bylaw not found' });
    return res.json(bylaw);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch bylaw' });
  }
});

// ── CREATE BYLAW ────────────────────────────────────────
router.post(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [
    body('title').trim().notEmpty(),
    body('content').trim().notEmpty(),
    body('category').trim().notEmpty(),
    body('penaltyAmount').optional().isFloat({ min: 0 }),
    body('effectiveDate').optional().isISO8601(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const bylaw = await prisma.associationBylaw.create({
        data: {
          societyId: req.user!.societyId!,
          title: req.body.title,
          content: req.body.content,
          category: req.body.category,
          penaltyAmount: req.body.penaltyAmount ? parseFloat(req.body.penaltyAmount) : null,
          effectiveDate: req.body.effectiveDate ? new Date(req.body.effectiveDate) : new Date(),
          isActive: true,
        },
      });

      return res.status(201).json(bylaw);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create bylaw' });
    }
  },
);

// ── UPDATE BYLAW ────────────────────────────────────────
router.put(
  '/:id',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const bylaw = await prisma.associationBylaw.update({
        where: { id: req.params.id },
        data: {
          ...req.body,
          penaltyAmount: req.body.penaltyAmount
            ? parseFloat(req.body.penaltyAmount)
            : undefined,
        },
      });
      return res.json(bylaw);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update bylaw' });
    }
  },
);

// ── DELETE (DEACTIVATE) BYLAW ───────────────────────────
router.delete(
  '/:id',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      await prisma.associationBylaw.update({
        where: { id: req.params.id },
        data: { isActive: false },
      });
      return res.json({ message: 'Bylaw deactivated successfully' });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to deactivate bylaw' });
    }
  },
);

export default router;
