import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ── GET MY FLAT (Owner/Tenant) ───────────────────────────
router.get('/my-flat', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    // Check if user is an owner
    const owner = await prisma.owner.findUnique({
      where: { userId },
      include: {
        flat: {
          include: {
            block: { include: { society: { select: { id: true, name: true } } } },
            owner: true,
            tenant: true,
            bills: { orderBy: { createdAt: 'desc' }, take: 12 },
          },
        },
      },
    });

    if (owner) return res.json(owner.flat);

    // Check if user is a tenant
    const tenant = await prisma.tenant.findUnique({
      where: { userId },
      include: {
        flat: {
          include: {
            block: { include: { society: { select: { id: true, name: true } } } },
            owner: true,
            tenant: true,
            bills: { orderBy: { createdAt: 'desc' }, take: 12 },
          },
        },
      },
    });

    if (tenant) return res.json(tenant.flat);

    return res.status(404).json({ error: 'No flat linked to your account' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch your flat' });
  }
});

// ── GET ALL SOCIETIES ───────────────────────────────────
router.get('/societies', async (req: AuthRequest, res) => {
  try {
    const where: any = {};
    // Non-SUPER_ADMIN users can only see their own society
    if (req.user!.role !== 'SUPER_ADMIN' && req.user!.societyId) {
      where.id = req.user!.societyId;
    }

    const societies = await prisma.society.findMany({
      where,
      include: { _count: { select: { blocks: true } } },
      orderBy: { name: 'asc' },
    });
    return res.json(societies);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch societies' });
  }
});

// ── CREATE SOCIETY ──────────────────────────────────────
router.post(
  '/societies',
  authorize('SUPER_ADMIN'),
  [
    body('name').trim().notEmpty(),
    body('address').trim().notEmpty(),
    body('city').trim().notEmpty(),
    body('state').trim().notEmpty(),
    body('pincode').trim().isLength({ min: 6, max: 6 }),
  ],
  validate,
  async (req: AuthRequest, res) => {
    try {
      const society = await prisma.society.create({ data: req.body });
      return res.status(201).json(society);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create society' });
    }
  },
);

// ── GET ALL FLATS ───────────────────────────────────────
router.get(
  '/flats',
  [query('blockId').optional().isUUID(), query('societyId').optional().isUUID()],
  validate,
  async (req: AuthRequest, res) => {
    try {
      const { blockId, societyId } = req.query;

      const where: any = {};
      if (blockId) where.blockId = blockId;
      if (societyId) where.block = { societyId };

      // For non-admin users, restrict to their society
      if (req.user!.role !== 'SUPER_ADMIN' && req.user!.societyId) {
        where.block = { ...where.block, societyId: req.user!.societyId };
      }

      const flats = await prisma.flat.findMany({
        where,
        include: {
          block: { include: { society: { select: { id: true, name: true } } } },
          owner: { select: { id: true, name: true, phone: true, email: true } },
          tenant: { select: { id: true, name: true, phone: true, email: true, isActive: true } },
        },
        orderBy: [{ block: { name: 'asc' } }, { floor: 'asc' }, { flatNumber: 'asc' }],
      });

      return res.json(flats);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch flats' });
    }
  },
);

// ── GET SINGLE FLAT ─────────────────────────────────────
router.get('/flats/:id', [param('id').isUUID()], validate, async (req: AuthRequest, res) => {
  try {
    const flat = await prisma.flat.findUnique({
      where: { id: req.params.id },
      include: {
        block: { include: { society: true } },
        owner: true,
        tenant: true,
        bills: { orderBy: { createdAt: 'desc' }, take: 12 },
        complaints: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });

    if (!flat) {
      return res.status(404).json({ error: 'Flat not found' });
    }

    return res.json(flat);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch flat' });
  }
});

// ── CREATE FLAT ─────────────────────────────────────────
router.post(
  '/flats',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [
    body('flatNumber').trim().notEmpty(),
    body('floor').isInt({ min: 0 }),
    body('type').isIn(['ONE_BHK', 'TWO_BHK', 'THREE_BHK', 'FOUR_BHK', 'STUDIO', 'PENTHOUSE', 'SHOP', 'OTHER']),
    body('areaSqFt').optional().isFloat({ min: 0 }),
    body('blockId').isUUID(),
  ],
  validate,
  async (req: AuthRequest, res) => {
    try {
      const flat = await prisma.flat.create({
        data: req.body,
        include: { block: true },
      });
      return res.status(201).json(flat);
    } catch (error: any) {
      if (error.code === 'P2002') {
        return res.status(409).json({ error: 'Flat number already exists in this block' });
      }
      return res.status(500).json({ error: 'Failed to create flat' });
    }
  },
);

// ── UPDATE FLAT ─────────────────────────────────────────
router.put(
  '/flats/:id',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res) => {
    try {
      const flat = await prisma.flat.update({
        where: { id: req.params.id },
        data: req.body,
        include: { block: true, owner: true, tenant: true },
      });
      return res.json(flat);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update flat' });
    }
  },
);

// ── DELETE FLAT ─────────────────────────────────────────
router.delete(
  '/flats/:id',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res) => {
    try {
      await prisma.flat.delete({ where: { id: req.params.id } });
      return res.json({ message: 'Flat deleted successfully' });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to delete flat' });
    }
  },
);

// ── BLOCKS CRUD ─────────────────────────────────────────
router.get('/blocks', async (req: AuthRequest, res) => {
  try {
    const where: any = {};
    // Always scope to user's society (SUPER_ADMIN can optionally filter by societyId)
    if (req.user!.role === 'SUPER_ADMIN' && req.query.societyId) {
      where.societyId = req.query.societyId;
    } else if (req.user!.societyId) {
      where.societyId = req.user!.societyId;
    }

    const blocks = await prisma.block.findMany({
      where,
      include: { _count: { select: { flats: true } }, society: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
    return res.json(blocks);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch blocks' });
  }
});

router.post(
  '/blocks',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [body('name').trim().notEmpty(), body('floors').isInt({ min: 1 }), body('societyId').isUUID()],
  validate,
  async (req: AuthRequest, res) => {
    try {
      const block = await prisma.block.create({ data: req.body });
      return res.status(201).json(block);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create block' });
    }
  },
);

// ── OWNER CRUD ──────────────────────────────────────────
router.post(
  '/owners',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [
    body('name').trim().notEmpty(),
    body('phone').notEmpty(),
    body('email').optional().isEmail(),
    body('flatId').isUUID(),
  ],
  validate,
  async (req: AuthRequest, res) => {
    try {
      const owner = await prisma.owner.create({
        data: req.body,
      });

      // Mark flat as occupied
      await prisma.flat.update({
        where: { id: req.body.flatId },
        data: { isOccupied: true },
      });

      return res.status(201).json(owner);
    } catch (error: any) {
      if (error.code === 'P2002') {
        return res.status(409).json({ error: 'This flat already has an owner' });
      }
      return res.status(500).json({ error: 'Failed to create owner' });
    }
  },
);

router.put(
  '/owners/:id',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res) => {
    try {
      const owner = await prisma.owner.update({
        where: { id: req.params.id },
        data: req.body,
      });
      return res.json(owner);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update owner' });
    }
  },
);

// ── TENANT CRUD ─────────────────────────────────────────
router.post(
  '/tenants',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [
    body('name').trim().notEmpty(),
    body('phone').notEmpty(),
    body('flatId').isUUID(),
    body('leaseStart').isISO8601(),
  ],
  validate,
  async (req: AuthRequest, res) => {
    try {
      const tenant = await prisma.tenant.create({ data: req.body });
      return res.status(201).json(tenant);
    } catch (error: any) {
      if (error.code === 'P2002') {
        return res.status(409).json({ error: 'This flat already has a tenant' });
      }
      return res.status(500).json({ error: 'Failed to create tenant' });
    }
  },
);

router.put(
  '/tenants/:id',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res) => {
    try {
      const tenant = await prisma.tenant.update({
        where: { id: req.params.id },
        data: req.body,
      });
      return res.json(tenant);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update tenant' });
    }
  },
);

export default router;
