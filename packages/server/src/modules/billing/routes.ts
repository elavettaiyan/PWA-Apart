import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import logger from '../../config/logger';

const router = Router();
router.use(authenticate);

const ALL_FLAT_TYPES = [
  'ONE_BHK',
  'TWO_BHK',
  'THREE_BHK',
  'FOUR_BHK',
  'STUDIO',
  'PENTHOUSE',
  'SHOP',
  'OTHER',
] as const;

function getSocietyId(req: AuthRequest) {
  return req.user!.role === 'SUPER_ADMIN'
    ? (req.query.societyId as string) || req.body.societyId || req.user!.societyId
    : req.user!.societyId;
}

function normalizeSharedConfig(societyId: string, configs: Array<any>) {
  const activeConfigs = configs.filter((config) => config.isActive !== false);
  const primaryConfig = activeConfigs[0];

  return {
    societyId,
    isConfigured: activeConfigs.length > 0,
    baseAmount: primaryConfig?.baseAmount ?? 0,
    waterCharge: primaryConfig?.waterCharge ?? 0,
    parkingCharge: primaryConfig?.parkingCharge ?? 0,
    sinkingFund: primaryConfig?.sinkingFund ?? 0,
    repairFund: primaryConfig?.repairFund ?? 0,
    otherCharges: primaryConfig?.otherCharges ?? 0,
    lateFeePerDay: primaryConfig?.lateFeePerDay ?? 0,
    dueDay: primaryConfig?.dueDay ?? 10,
    configuredFlatTypes: activeConfigs.map((config) => config.flatType),
    totalMonthlyAmount:
      (primaryConfig?.baseAmount ?? 0) +
      (primaryConfig?.waterCharge ?? 0) +
      (primaryConfig?.parkingCharge ?? 0) +
      (primaryConfig?.sinkingFund ?? 0) +
      (primaryConfig?.repairFund ?? 0) +
      (primaryConfig?.otherCharges ?? 0),
  };
}

// ── GET MAINTENANCE CONFIGS ─────────────────────────────
router.get('/config', async (req: AuthRequest, res) => {
  try {
    const societyId = getSocietyId(req);
    if (!societyId) return res.status(400).json({ error: 'Society ID required' });

    const configs = await prisma.maintenanceConfig.findMany({
      where: { societyId, isActive: true },
      orderBy: { flatType: 'asc' },
    });

    return res.json(configs);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch maintenance config' });
  }
});

router.get('/config/summary', async (req: AuthRequest, res) => {
  try {
    const societyId = getSocietyId(req);
    if (!societyId) return res.status(400).json({ error: 'Society ID required' });

    const configs = await prisma.maintenanceConfig.findMany({
      where: { societyId, isActive: true },
      orderBy: { flatType: 'asc' },
    });

    return res.json(normalizeSharedConfig(societyId, configs));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch maintenance config summary' });
  }
});

// ── CREATE/UPDATE MAINTENANCE CONFIG ────────────────────
router.post(
  '/config',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [
    body('societyId').isUUID(),
    body('flatType').optional().isIn(ALL_FLAT_TYPES),
    body('baseAmount').isFloat({ min: 0 }),
    body('waterCharge').optional().isFloat({ min: 0 }),
    body('parkingCharge').optional().isFloat({ min: 0 }),
    body('sinkingFund').optional().isFloat({ min: 0 }),
    body('repairFund').optional().isFloat({ min: 0 }),
    body('otherCharges').optional().isFloat({ min: 0 }),
    body('lateFeePerDay').optional().isFloat({ min: 0 }),
    body('dueDay').optional().isInt({ min: 1, max: 28 }),
  ],
  validate,
  async (req: AuthRequest, res) => {
    try {
      if (req.user!.role !== 'SUPER_ADMIN' && req.body.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const {
        societyId,
        flatType,
        baseAmount,
        waterCharge = 0,
        parkingCharge = 0,
        sinkingFund = 0,
        repairFund = 0,
        otherCharges = 0,
        lateFeePerDay = 0,
        dueDay = 10,
      } = req.body;

      const targetFlatTypes = flatType ? [flatType] : [...ALL_FLAT_TYPES];

      const configs = await prisma.$transaction(async (tx) => {
        await tx.maintenanceConfig.updateMany({
          where: {
            societyId,
            flatType: { in: targetFlatTypes },
            isActive: true,
          },
          data: { isActive: false },
        });

        await tx.maintenanceConfig.createMany({
          data: targetFlatTypes.map((targetFlatType) => ({
            societyId,
            flatType: targetFlatType,
            baseAmount,
            waterCharge,
            parkingCharge,
            sinkingFund,
            repairFund,
            otherCharges,
            lateFeePerDay,
            dueDay,
            isActive: true,
          })),
        });

        return tx.maintenanceConfig.findMany({
          where: { societyId, isActive: true },
          orderBy: { flatType: 'asc' },
        });
      });

      return res.status(201).json(normalizeSharedConfig(societyId, configs));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create maintenance config' });
    }
  },
);

// ── GENERATE MONTHLY BILLS ──────────────────────────────
router.post(
  '/generate',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [body('societyId').isUUID(), body('month').isInt({ min: 1, max: 12 }), body('year').isInt({ min: 2020 })],
  validate,
  async (req: AuthRequest, res) => {
    try {
      const { societyId, month, year } = req.body;

      // SECURITY: Verify societyId matches admin's society
      if (req.user!.role !== 'SUPER_ADMIN' && societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Get all flats in society with their types
      const flats = await prisma.flat.findMany({
        where: { block: { societyId }, isOccupied: true },
        include: { block: true },
      });

      if (flats.length === 0) {
        return res.status(400).json({
          error: 'No occupied flats found. Add occupied flats before generating bills.',
          generatedCount: 0,
          totalFlats: 0,
        });
      }

      // Get active configs
      const configs = await prisma.maintenanceConfig.findMany({
        where: { societyId, isActive: true },
      });

      if (configs.length === 0) {
        return res.status(400).json({
          error: 'Set the monthly maintenance amount before generating bills.',
          generatedCount: 0,
          totalFlats: flats.length,
        });
      }

      const configMap = new Map(configs.map((c) => [c.flatType, c]));

      let generatedCount = 0;
      const errors: string[] = [];

      for (const flat of flats) {
        const cfg = configMap.get(flat.type);
        if (!cfg) {
          errors.push(`No config for flat type ${flat.type} (Flat: ${flat.flatNumber})`);
          continue;
        }

        // Check if bill already exists
        const existing = await prisma.maintenanceBill.findUnique({
          where: { flatId_month_year: { flatId: flat.id, month, year } },
        });

        if (existing) {
          errors.push(`Bill already exists for ${flat.flatNumber} - ${month}/${year}`);
          continue;
        }

        const totalAmount =
          cfg.baseAmount +
          cfg.waterCharge +
          cfg.parkingCharge +
          cfg.sinkingFund +
          cfg.repairFund +
          cfg.otherCharges;

        const dueDay = Math.min(Math.max(cfg.dueDay, 1), 28);
        const dueDate = new Date(year, month - 1, dueDay);

        await prisma.maintenanceBill.create({
          data: {
            flatId: flat.id,
            month,
            year,
            baseAmount: cfg.baseAmount,
            waterCharge: cfg.waterCharge,
            parkingCharge: cfg.parkingCharge,
            sinkingFund: cfg.sinkingFund,
            repairFund: cfg.repairFund,
            otherCharges: cfg.otherCharges,
            totalAmount,
            dueDate,
            status: 'PENDING',
          },
        });

        generatedCount++;
      }

      logger.info(`Generated ${generatedCount} bills for ${month}/${year}`);

      if (generatedCount === 0) {
        return res.status(400).json({
          error: 'No bills were generated.',
          generatedCount,
          totalFlats: flats.length,
          errors,
        });
      }

      return res.json({
        message: `Generated ${generatedCount} bills`,
        generatedCount,
        totalFlats: flats.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      logger.error('Bill generation failed:', error);
      return res.status(500).json({ error: 'Failed to generate bills' });
    }
  },
);

// ── GET ALL BILLS ───────────────────────────────────────
router.get(
  '/',
  [
    query('month').optional().isInt({ min: 1, max: 12 }),
    query('year').optional().isInt({ min: 2020 }),
    query('status').optional().isIn(['PENDING', 'PARTIAL', 'PAID', 'OVERDUE']),
    query('flatId').optional().isUUID(),
  ],
  validate,
  async (req: AuthRequest, res) => {
    try {
      const where: any = {};

      if (req.query.month) where.month = parseInt(req.query.month as string);
      if (req.query.year) where.year = parseInt(req.query.year as string);
      if (req.query.status) where.status = req.query.status;
      if (req.query.flatId) where.flatId = req.query.flatId;

      if (req.user!.role === 'SUPER_ADMIN' || req.user!.role === 'ADMIN') {
        where.flat = { block: { societyId: req.user!.societyId } };
      }

      // Non-admin: only their own flat's bills
      if (req.user!.role === 'OWNER' || req.user!.role === 'TENANT') {
        const userFlat = await getUserFlat(req.user!.id);
        if (userFlat) where.flatId = userFlat.id;
        else return res.json([]);
      }

      const bills = await prisma.maintenanceBill.findMany({
        where,
        include: {
          flat: {
            include: {
              block: { select: { name: true } },
              owner: { select: { name: true, phone: true } },
            },
          },
          payments: { orderBy: { createdAt: 'desc' } },
        },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      });

      return res.json(bills);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch bills' });
    }
  },
);

// ── GET SINGLE BILL ─────────────────────────────────────
router.get('/:id', [param('id').isUUID()], validate, async (req: AuthRequest, res) => {
  try {
    const bill = await prisma.maintenanceBill.findUnique({
      where: { id: req.params.id },
      include: {
        flat: { include: { block: true, owner: true, tenant: true } },
        payments: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!bill) return res.status(404).json({ error: 'Bill not found' });

    // SECURITY: Verify bill belongs to user's society
    if (req.user!.role !== 'SUPER_ADMIN' && bill.flat.block.societyId !== req.user!.societyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.json(bill);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch bill' });
  }
});

// ── RECORD MANUAL PAYMENT (cash/cheque) ─────────────────
router.post(
  '/:id/pay',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [
    param('id').isUUID(),
    body('amount').isFloat({ min: 1 }),
    body('method').isIn(['CASH', 'CHEQUE', 'BANK_TRANSFER', 'UPI_OTHER']),
  ],
  validate,
  async (req: AuthRequest, res) => {
    try {
      const bill = await prisma.maintenanceBill.findUnique({
        where: { id: req.params.id },
      });

      if (!bill) return res.status(404).json({ error: 'Bill not found' });

      const { amount, method, notes, receiptNo } = req.body;
      const newPaidAmount = bill.paidAmount + amount;

      const payment = await prisma.payment.create({
        data: {
          billId: bill.id,
          amount,
          method,
          status: 'SUCCESS',
          receiptNo,
          notes,
          paidAt: new Date(),
        },
      });

      const newStatus = newPaidAmount >= bill.totalAmount ? 'PAID' : 'PARTIAL';

      await prisma.maintenanceBill.update({
        where: { id: bill.id },
        data: { paidAmount: newPaidAmount, status: newStatus },
      });

      return res.json({ payment, newStatus, paidAmount: newPaidAmount });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to record payment' });
    }
  },
);

// Helper
async function getUserFlat(userId: string) {
  const owner = await prisma.owner.findUnique({ where: { userId }, select: { flatId: true } });
  if (owner) return { id: owner.flatId };
  const tenant = await prisma.tenant.findUnique({ where: { userId }, select: { flatId: true } });
  if (tenant) return { id: tenant.flatId };
  return null;
}

export default router;
