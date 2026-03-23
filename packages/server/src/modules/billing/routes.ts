import { Response, Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest, FINANCIAL_ROLES, RESIDENT_ROLES } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import logger from '../../config/logger';
import { buildResidentBillFilter, canResidentAccessBill } from './scope';
import { sendPaymentReceiptEmail, PaymentReceiptData } from '../../config/email';

const router = Router();
router.use(authenticate);

const nowMs = () => Date.now();

// ── CONFIG SUMMARY CACHE ────────────────────────────────
type ConfigSummaryCache = { data: any; expiresAt: number };
const configSummaryCache = new Map<string, ConfigSummaryCache>();
const CONFIG_SUMMARY_TTL = 60_000; // 60s

function getCachedConfigSummary(societyId: string) {
  const entry = configSummaryCache.get(societyId);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  configSummaryCache.delete(societyId);
  return null;
}

function setCachedConfigSummary(societyId: string, data: any) {
  configSummaryCache.set(societyId, { data, expiresAt: Date.now() + CONFIG_SUMMARY_TTL });
}

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
router.get('/config', async (req: AuthRequest, res: Response) => {
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

router.get('/config/summary', async (req: AuthRequest, res: Response) => {
  const requestStart = nowMs();
  try {
    const scopeStart = nowMs();
    const societyId = getSocietyId(req);
    const scopeMs = nowMs() - scopeStart;
    if (!societyId) return res.status(400).json({ error: 'Society ID required' });

    // Check cache first
    const cached = getCachedConfigSummary(societyId);
    if (cached) {
      logger.info('billing.config.summary.performance', {
        userId: req.user?.id,
        role: req.user?.role,
        societyId,
        cacheHit: true,
        timings: { scopeMs, dbQueryMs: 0, totalMs: nowMs() - requestStart },
      });
      return res.json(cached);
    }

    const dbStart = nowMs();
    const configs = await prisma.maintenanceConfig.findMany({
      where: { societyId, isActive: true },
      orderBy: { flatType: 'asc' },
    });
    const dbQueryMs = nowMs() - dbStart;

    const result = normalizeSharedConfig(societyId, configs);
    setCachedConfigSummary(societyId, result);

    logger.info('billing.config.summary.performance', {
      userId: req.user?.id,
      role: req.user?.role,
      societyId,
      cacheHit: false,
      configCount: configs.length,
      timings: {
        scopeMs,
        dbQueryMs,
        totalMs: nowMs() - requestStart,
      },
    });

    return res.json(result);
  } catch (error) {
    logger.error('billing.config.summary.performance.error', {
      userId: req.user?.id,
      role: req.user?.role,
      societyId: req.user?.societyId,
      timings: {
        totalMs: nowMs() - requestStart,
      },
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({ error: 'Failed to fetch maintenance config summary' });
  }
});

// ── CREATE/UPDATE MAINTENANCE CONFIG ────────────────────
router.post(
  '/config',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
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
  async (req: AuthRequest, res: Response) => {
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

      const result = normalizeSharedConfig(societyId, configs);
      configSummaryCache.delete(societyId); // Invalidate cache on config change
      return res.status(201).json(result);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create maintenance config' });
    }
  },
);

// ── GENERATE MONTHLY BILLS ──────────────────────────────
router.post(
  '/generate',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  [body('societyId').isUUID(), body('month').isInt({ min: 1, max: 12 }), body('year').isInt({ min: 2020 })],
  validate,
  async (req: AuthRequest, res: Response) => {
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
  async (req: AuthRequest, res: Response) => {
    const requestStart = nowMs();
    const timing = {
      parseFiltersMs: 0,
      scopeMs: 0,
      residentLookupMs: 0,
      dbQueryMs: 0,
      responseMs: 0,
      serializeMs: 0,
    };

    try {
      const parseStart = nowMs();
      const where: any = {};

      if (req.query.month) where.month = parseInt(req.query.month as string);
      if (req.query.year) where.year = parseInt(req.query.year as string);
      if (req.query.status) where.status = req.query.status;
      if (req.query.flatId) where.flatId = req.query.flatId;

      // Safety fallback: if admin/super-admin does not send month/year,
      // default to current month to avoid heavy full-history scans.
      if (
        (req.user!.role === 'SUPER_ADMIN' || req.user!.role === 'ADMIN')
        && where.month === undefined
        && where.year === undefined
      ) {
        const now = new Date();
        where.month = now.getMonth() + 1;
        where.year = now.getFullYear();
      }

      timing.parseFiltersMs = nowMs() - parseStart;

      const scopeStart = nowMs();
      if (req.user!.role === 'SUPER_ADMIN' || [...FINANCIAL_ROLES].includes(req.user!.role as any)) {
        where.flat = { block: { societyId: req.user!.societyId } };
      }

      // Residents and SERVICE_STAFF: only their linked flats in active society
      if ([...RESIDENT_ROLES, 'SERVICE_STAFF'].includes(req.user!.role as any)) {
        if (!req.user!.societyId) return res.json([]);

        const residentLookupStart = nowMs();
        const userFlatIds = await getUserFlatIds(req.user!.id, req.user!.societyId);
        timing.residentLookupMs = nowMs() - residentLookupStart;
        if (userFlatIds.length > 0) {
          Object.assign(where, buildResidentBillFilter(userFlatIds));
        }
        else return res.json([]);

        where.flat = {
          ...(where.flat || {}),
          block: { societyId: req.user!.societyId },
        };
      }
      timing.scopeMs = nowMs() - scopeStart;

      const dbStart = nowMs();

      // Single raw SQL query for admin: 1 DB round trip instead of Prisma's multiple
      const societyId = req.user!.societyId;
      const isAdminRole = req.user!.role === 'SUPER_ADMIN' || req.user!.role === 'ADMIN';

      let payload: any[];

      if (isAdminRole && societyId) {
        // Build dynamic WHERE clauses for optional filters
        const params: any[] = [societyId];
        const conditions = ['bl."societyId" = $1'];

        if (where.month != null) {
          params.push(where.month);
          conditions.push(`b.month = $${params.length}`);
        }
        if (where.year != null) {
          params.push(where.year);
          conditions.push(`b.year = $${params.length}`);
        }
        if (where.status) {
          params.push(where.status);
          conditions.push(`b.status::text = $${params.length}`);
        }
        if (where.flatId) {
          params.push(where.flatId);
          conditions.push(`b."flatId" = $${params.length}`);
        }

        const sql = `
          SELECT
            b.id, b."flatId", b.month, b.year,
            b."totalAmount", b."paidAmount", b.status, b."dueDate",
            f."flatNumber",
            bl.name AS "blockName",
            o.name AS "ownerName", o.phone AS "ownerPhone"
          FROM maintenance_bills b
          JOIN flats f ON f.id = b."flatId"
          JOIN blocks bl ON bl.id = f."blockId"
          LEFT JOIN owners o ON o."flatId" = f.id
          WHERE ${conditions.join(' AND ')}
          ORDER BY b.year DESC, b.month DESC
        `;

        const rows: any[] = await prisma.$queryRawUnsafe(sql, ...params);

        payload = rows.map((r) => ({
          id: r.id,
          flatId: r.flatId,
          month: r.month,
          year: r.year,
          totalAmount: Number(r.totalAmount),
          paidAmount: Number(r.paidAmount),
          status: r.status,
          dueDate: r.dueDate,
          flat: {
            flatNumber: r.flatNumber,
            block: { name: r.blockName },
            owner: r.ownerName ? { name: r.ownerName, phone: r.ownerPhone } : null,
          },
        }));
      } else {
        // Resident path: small result set, use original include
        const bills = await prisma.maintenanceBill.findMany({
          where,
          include: {
            flat: {
              include: {
                block: { select: { name: true } },
                owner: { select: { name: true, phone: true } },
              },
            },
          },
          orderBy: [{ year: 'desc' }, { month: 'desc' }],
        });
        payload = bills;
      }

      timing.dbQueryMs = nowMs() - dbStart;

      const responseStart = nowMs();
      timing.responseMs = nowMs() - responseStart;

      const serializeStart = nowMs();
      const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
      timing.serializeMs = nowMs() - serializeStart;

      logger.info('billing.list.performance', {
        userId: req.user?.id,
        role: req.user?.role,
        societyId: req.user?.societyId,
        month: req.query.month ?? null,
        year: req.query.year ?? null,
        effectiveMonth: where.month ?? null,
        effectiveYear: where.year ?? null,
        status: req.query.status ?? null,
        flatId: req.query.flatId ?? null,
        resultCount: payload.length,
        payloadBytes,
        timings: {
          ...timing,
          totalMs: nowMs() - requestStart,
        },
      });

      return res.json(payload);
    } catch (error) {
      logger.error('billing.list.performance.error', {
        userId: req.user?.id,
        role: req.user?.role,
        societyId: req.user?.societyId,
        month: req.query.month ?? null,
        year: req.query.year ?? null,
        effectiveMonth: null,
        effectiveYear: null,
        status: req.query.status ?? null,
        flatId: req.query.flatId ?? null,
        timings: {
          ...timing,
          totalMs: nowMs() - requestStart,
        },
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(500).json({ error: 'Failed to fetch bills' });
    }
  },
);

// ── GET SINGLE BILL ─────────────────────────────────────
router.get('/:id', [param('id').isUUID()], validate, async (req: AuthRequest, res: Response) => {
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

    // SECURITY: Owner/Tenant/SERVICE_STAFF can only access bills for their linked flats.
    if ([...RESIDENT_ROLES, 'SERVICE_STAFF'].includes(req.user!.role as any)) {
      if (!req.user!.societyId) return res.status(403).json({ error: 'Access denied' });
      const userFlatIds = await getUserFlatIds(req.user!.id, req.user!.societyId);
      if (!canResidentAccessBill(bill.flatId, userFlatIds)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    return res.json(bill);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch bill' });
  }
});

// ── RECORD MANUAL PAYMENT (cash/cheque) ─────────────────
router.post(
  '/:id/pay',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  [
    param('id').isUUID(),
    body('amount').isFloat({ min: 1 }),
    body('method').isIn(['CASH', 'CHEQUE', 'BANK_TRANSFER', 'UPI_OTHER']),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const bill = await prisma.maintenanceBill.findUnique({
        where: { id: req.params.id },
        include: { flat: { include: { block: true } } },
      });

      if (!bill) return res.status(404).json({ error: 'Bill not found' });

      // SECURITY: Admin can only record payment inside their active society.
      if (req.user!.role !== 'SUPER_ADMIN' && bill.flat.block.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

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

      // Send receipt email (fire-and-forget)
      const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      try {
        const fullBill = await prisma.maintenanceBill.findUnique({
          where: { id: bill.id },
          include: {
            flat: {
              include: {
                owner: true,
                tenant: true,
                block: { include: { society: true } },
              },
            },
          },
        });

        if (fullBill) {
          const flat = fullBill.flat;
          const recipient = (flat.tenant?.email) ? { name: flat.tenant.name, email: flat.tenant.email }
                          : (flat.owner?.email)  ? { name: flat.owner.name,  email: flat.owner.email }
                          : null;

          if (recipient) {
            const receiptData: PaymentReceiptData = {
              userName: recipient.name,
              flatNumber: flat.flatNumber,
              blockName: flat.block.name,
              societyName: flat.block.society.name,
              billMonth: `${MONTH_NAMES[fullBill.month - 1]} ${fullBill.year}`,
              amount,
              totalAmount: fullBill.totalAmount,
              paidAmount: fullBill.paidAmount,
              billStatus: fullBill.status,
              method,
              transactionId: receiptNo || undefined,
              paidAt: new Date(),
            };
            sendPaymentReceiptEmail(recipient.email, receiptData).catch(() => {});
          }
        }
      } catch (emailErr: any) {
        logger.error('Record payment receipt email failed (non-blocking)', { billId: bill.id, error: emailErr.message });
      }

      return res.json({ payment, newStatus, paidAmount: newPaidAmount });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to record payment' });
    }
  },
);

// Helper
async function getUserFlatIds(userId: string, societyId: string) {
  const [owners, tenants] = await Promise.all([
    prisma.owner.findMany({
      where: { userId, flat: { block: { societyId } } },
      select: { flatId: true },
    }),
    prisma.tenant.findMany({
      where: { userId, flat: { block: { societyId } } },
      select: { flatId: true },
    }),
  ]);

  return [...new Set([...owners.map((owner) => owner.flatId), ...tenants.map((tenant) => tenant.flatId)])];
}

export default router;
