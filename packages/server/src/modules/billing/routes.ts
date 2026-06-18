import { Prisma } from '@prisma/client';
import { Response, Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest, FINANCIAL_ROLES, RESIDENT_ROLES } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import logger from '../../config/logger';
import { buildResidentBillFilter, canResidentAccessBill } from './scope';
import { sendPaymentReceiptEmail, PaymentReceiptData } from '../../config/email';
import { notifyBillGenerated, notifyPaymentSuccess } from '../notifications/service';
import { allocatePayment } from '../collections/service';

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
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const BILL_KINDS = ['MAINTENANCE', 'OPENING_BALANCE', 'SPECIAL'] as const;
const BILL_LINE_ITEM_CATEGORIES = ['MAINTENANCE_COMPONENT', 'OPENING_BALANCE', 'FINE', 'DAMAGE', 'COMMON_ITEM_BREAKAGE', 'OTHER'] as const;
const CUSTOM_BILLING_MODES = ['OPENING_BALANCE', 'STANDALONE_SPECIAL'] as const;

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
    lateFeeAmount: primaryConfig?.lateFeeAmount ?? 0,
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

function buildMaintenanceLineItems(config: {
  baseAmount: number;
  waterCharge: number;
  parkingCharge: number;
  sinkingFund: number;
  repairFund: number;
  otherCharges: number;
}) {
  return [
    { label: 'Base Maintenance', amount: Number(config.baseAmount || 0) },
    { label: 'Water Charge', amount: Number(config.waterCharge || 0) },
    { label: 'Parking Charge', amount: Number(config.parkingCharge || 0) },
    { label: 'Sinking Fund', amount: Number(config.sinkingFund || 0) },
    { label: 'Repair Fund', amount: Number(config.repairFund || 0) },
    { label: 'Other Charges', amount: Number(config.otherCharges || 0) },
  ]
    .filter((item) => item.amount > 0)
    .map((item, index) => ({
      label: item.label,
      amount: item.amount,
      category: 'MAINTENANCE_COMPONENT' as const,
      sortOrder: index,
    }));
}

function normalizeBillStatus(totalAmount: number, paidAmount: number, dueDate: Date) {
  if (paidAmount >= totalAmount) return 'PAID';
  if (paidAmount > 0) return 'PARTIAL';
  return dueDate.getTime() < Date.now() ? 'OVERDUE' : 'PENDING';
}

function resolveDueDateForPeriod(month: number, year: number, dueDay: number) {
  const normalizedDueDay = Math.min(Math.max(Number(dueDay || 10), 1), 28);
  return new Date(year, month - 1, normalizedDueDay);
}

function buildBillLabel(bill: {
  billKind?: string | null;
  title?: string | null;
  month?: number | null;
  year?: number | null;
  appliesToMonth?: number | null;
  appliesToYear?: number | null;
}) {
  if (bill.title) return bill.title;
  const labelMonth = bill.appliesToMonth ?? bill.month;
  const labelYear = bill.appliesToYear ?? bill.year;

  if (bill.billKind === 'OPENING_BALANCE') return 'Opening Balance';
  if (bill.billKind === 'SPECIAL') return labelMonth && labelYear ? `Special Bill - ${labelMonth}/${labelYear}` : 'Special Bill';
  return labelMonth && labelYear ? `Monthly Maintenance - ${labelMonth}/${labelYear}` : 'Maintenance Bill';
}

function buildBillPeriodText(bill: {
  billKind?: string | null;
  title?: string | null;
  month?: number | null;
  year?: number | null;
  appliesToMonth?: number | null;
  appliesToYear?: number | null;
}) {
  const labelMonth = bill.appliesToMonth ?? bill.month;
  const labelYear = bill.appliesToYear ?? bill.year;
  if (labelMonth && labelYear) return `${MONTH_NAMES[labelMonth - 1]} ${labelYear}`;
  return buildBillLabel(bill);
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
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
    body('lateFeeAmount').optional().isFloat({ min: 0 }),
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
        lateFeeAmount = 0,
      } = req.body;

      const targetFlatTypes = flatType ? [flatType] : [...ALL_FLAT_TYPES];

      const configs = await prisma.$transaction(async (tx) => {
        await tx.maintenanceConfig.deleteMany({
          where: {
            societyId,
            flatType: { in: targetFlatTypes },
            isActive: false,
          },
        });

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
            lateFeeAmount,
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
      const societySettings = await prisma.societySettings.findUnique({ where: { societyId } });

      if (configs.length === 0) {
        return res.status(400).json({
          error: 'Set the monthly maintenance amount before generating bills.',
          generatedCount: 0,
          totalFlats: flats.length,
        });
      }

      const configMap = new Map(configs.map((c) => [c.flatType, c]));

      let generatedCount = 0;
      const generatedBillIds: string[] = [];
      const errors: string[] = [];

      for (const flat of flats) {
        const cfg = configMap.get(flat.type);
        if (!cfg) {
          errors.push(`No config for flat type ${flat.type} (Flat: ${flat.flatNumber})`);
          continue;
        }

        const existingMaintenanceBill = await prisma.maintenanceBill.findFirst({
          where: { flatId: flat.id, month, year, billKind: 'MAINTENANCE' },
        });

        if (existingMaintenanceBill) {
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

        const dueDay = Math.min(Math.max(Number(societySettings?.dueDay ?? 10), 1), 28);
        const dueDate = resolveDueDateForPeriod(month, year, Number(societySettings?.dueDay ?? 10));

        let bill;
        try {
          bill = await prisma.maintenanceBill.create({
            data: {
              flatId: flat.id,
              month,
              year,
              appliesToMonth: month,
              appliesToYear: year,
              billKind: 'MAINTENANCE',
              title: `Monthly Maintenance - ${month}/${year}`,
              baseAmount: cfg.baseAmount,
              waterCharge: cfg.waterCharge,
              parkingCharge: cfg.parkingCharge,
              sinkingFund: cfg.sinkingFund,
              repairFund: cfg.repairFund,
              otherCharges: cfg.otherCharges,
              totalAmount,
              dueDate,
              status: 'PENDING',
              lineItems: {
                create: buildMaintenanceLineItems(cfg),
              },
            },
          });
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            errors.push(`Bill already exists for ${flat.flatNumber} - ${month}/${year}`);
            continue;
          }
          throw error;
        }

        // Auto-apply advance balance if society setting enabled
        try {
          const societySettings = await prisma.societySettings.findUnique({ where: { societyId } });
          if (societySettings?.autoAdjustAdvance) {
            const adv = await prisma.advanceBalance.findUnique({ where: { flatId: flat.id } });
            if (adv && adv.amount > 0) {
              const toApply = Math.min(Number(adv.amount), Number(bill.totalAmount));
              if (toApply > 0) {
                const newPaid = (bill.paidAmount || 0) + toApply;
                const newStatus = newPaid >= bill.totalAmount ? 'PAID' : newPaid > 0 ? 'PARTIAL' : 'PENDING';

                // persist payment record and update bill + advance atomically
                const payment = await prisma.$transaction(async (tx) => {
                  const createdPayment = await tx.payment.create({
                    data: {
                      billId: bill.id,
                      amount: toApply,
                      method: 'ADVANCE',
                      status: 'SUCCESS',
                      notes: 'Auto-applied advance balance',
                      paidAt: new Date(),
                    },
                  });

                  await tx.maintenanceBill.update({ where: { id: bill.id }, data: { paidAmount: newPaid, status: newStatus } });

                  if (adv.amount - toApply <= 0) {
                    await tx.advanceBalance.delete({ where: { id: adv.id } });
                  } else {
                    await tx.advanceBalance.update({ where: { id: adv.id }, data: { amount: { set: adv.amount - toApply } } });
                  }

                  return createdPayment;
                });

                // Fire notification for applied payment (non-blocking)
                notifyPaymentSuccess(payment.id).catch(() => {});
              }
            }
          }
        } catch (applyErr: any) {
          logger.error('Failed to auto-apply advance during bill generation', { flatId: flat.id, error: applyErr?.message });
        }

        generatedBillIds.push(bill.id);
        generatedCount++;
      }

      logger.info(`Generated ${generatedCount} bills for ${month}/${year}`);

      for (const billId of generatedBillIds) {
        notifyBillGenerated(billId).catch((error: any) => {
          logger.error('Bill generation notification failed', { billId, error: error.message });
        });
      }

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

router.post(
  '/custom',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  [
    body('mode').isIn(CUSTOM_BILLING_MODES as unknown as string[]),
    body('amount').isFloat({ min: 1 }),
    body('flatId').optional().isUUID(),
    body('title').optional().isString().isLength({ min: 1, max: 120 }),
    body('description').optional().isString().isLength({ max: 500 }),
    body('notes').optional().isString().isLength({ max: 1000 }),
    body('appliesToMonth').optional().isInt({ min: 1, max: 12 }),
    body('appliesToYear').optional().isInt({ min: 2020 }),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { mode, amount, flatId, title, description, notes, appliesToMonth, appliesToYear } = req.body;
      const category = mode === 'OPENING_BALANCE' ? 'OPENING_BALANCE' : 'OTHER';

      if (!flatId) return res.status(400).json({ error: 'Flat ID is required' });

      const flat = await prisma.flat.findUnique({
        where: { id: flatId },
        include: { block: true },
      });

      if (!flat) return res.status(404).json({ error: 'Flat not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && flat.block.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (mode === 'OPENING_BALANCE') {
        const existingOpeningBalance = await prisma.maintenanceBill.findFirst({
          where: { flatId, billKind: 'OPENING_BALANCE' },
        });

        if (existingOpeningBalance) {
          return res.status(400).json({ error: 'Opening balance already exists for this flat' });
        }
      }

      const societySettings = await prisma.societySettings.findUnique({
        where: { societyId: flat.block.societyId },
        select: { dueDay: true },
      });
      const referenceDate = new Date();
      const effectiveAppliesToMonth = appliesToMonth ?? (mode === 'OPENING_BALANCE' ? null : referenceDate.getMonth() + 1);
      const effectiveAppliesToYear = appliesToYear ?? (mode === 'OPENING_BALANCE' ? null : referenceDate.getFullYear());
      const dueMonth = effectiveAppliesToMonth ?? referenceDate.getMonth() + 1;
      const dueYear = effectiveAppliesToYear ?? referenceDate.getFullYear();
      const resolvedDueDate = resolveDueDateForPeriod(dueMonth, dueYear, Number(societySettings?.dueDay ?? 10));
      const resolvedTitle = title || (mode === 'OPENING_BALANCE' ? 'Opening Balance' : 'Special Bill');
      const baseAmount = mode === 'OPENING_BALANCE' ? Number(amount) : 0;
      const otherCharges = mode === 'OPENING_BALANCE' ? 0 : Number(amount);

      let createdBill;
      try {
        createdBill = await prisma.maintenanceBill.create({
          data: {
            flatId,
            month: null,
            year: null,
            billKind: mode === 'OPENING_BALANCE' ? 'OPENING_BALANCE' : 'SPECIAL',
            title: resolvedTitle,
            description,
            baseAmount,
            waterCharge: 0,
            parkingCharge: 0,
            sinkingFund: 0,
            repairFund: 0,
            otherCharges,
            totalAmount: Number(amount),
            dueDate: resolvedDueDate,
            status: normalizeBillStatus(Number(amount), 0, resolvedDueDate) as any,
            notes,
            appliesToMonth: effectiveAppliesToMonth,
            appliesToYear: effectiveAppliesToYear,
            createdById: req.user?.id,
            lineItems: {
              create: [
                {
                  label: resolvedTitle,
                  category,
                  amount: Number(amount),
                  notes,
                  sortOrder: 0,
                },
              ],
            },
          },
          include: {
            flat: { include: { block: true, owner: true, tenant: true } },
            payments: { orderBy: { createdAt: 'desc' } },
            lineItems: { orderBy: { sortOrder: 'asc' } },
          },
        });
      } catch (error) {
        if (isUniqueConstraintError(error) && mode === 'OPENING_BALANCE') {
          return res.status(400).json({ error: 'Opening balance already exists for this flat' });
        }
        throw error;
      }

      return res.status(201).json(createdBill);
    } catch (error) {
      logger.error('Failed to create custom bill', error);
      return res.status(500).json({ error: 'Failed to create custom bill' });
    }
  },
);

router.get(
  '/owner-summary',
  [
    query('month').optional().isInt({ min: 1, max: 12 }),
    query('year').optional().isInt({ min: 2020 }),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user?.societyId) {
        return res.json({
          month: Number(req.query.month) || new Date().getMonth() + 1,
          year: Number(req.query.year) || new Date().getFullYear(),
          outstandingAmount: 0,
          advanceAmount: 0,
          monthDueAmount: 0,
          netPayableAmount: 0,
        });
      }

      const month = Number(req.query.month) || new Date().getMonth() + 1;
      const year = Number(req.query.year) || new Date().getFullYear();
      const canUseOwnerScopedView = [...FINANCIAL_ROLES, ...RESIDENT_ROLES].includes(req.user.role as any);
      const flatIds = canUseOwnerScopedView
        ? [...FINANCIAL_ROLES].includes(req.user.role as any)
          ? await getUserOwnedFlatIds(req.user.id, req.user.societyId)
          : await getUserFlatIds(req.user.id, req.user.societyId)
        : [];

      if (flatIds.length === 0) {
        return res.json({
          month,
          year,
          outstandingAmount: 0,
          advanceAmount: 0,
          monthDueAmount: 0,
          netPayableAmount: 0,
        });
      }

      const [bills, advances] = await Promise.all([
        prisma.maintenanceBill.findMany({
          where: {
            flatId: { in: flatIds },
            flat: { block: { societyId: req.user.societyId } },
          },
          select: {
            month: true,
            year: true,
            appliesToMonth: true,
            appliesToYear: true,
            totalAmount: true,
            paidAmount: true,
          },
        }),
        prisma.advanceBalance.findMany({
          where: {
            flatId: { in: flatIds },
            societyId: req.user.societyId,
          },
          select: { amount: true },
        }),
      ]);

      const outstandingAmount = Number(
        bills.reduce((sum, bill) => sum + Math.max(0, Number(bill.totalAmount) - Number(bill.paidAmount)), 0).toFixed(2),
      );
      const monthDueAmount = Number(
        bills
          .filter((bill) => (bill.appliesToMonth ?? bill.month) === month && (bill.appliesToYear ?? bill.year) === year)
          .reduce((sum, bill) => sum + Math.max(0, Number(bill.totalAmount) - Number(bill.paidAmount)), 0)
          .toFixed(2),
      );
      const advanceAmount = Number(advances.reduce((sum, item) => sum + Number(item.amount), 0).toFixed(2));
      const netPayableAmount = Number(Math.max(0, outstandingAmount - advanceAmount).toFixed(2));

      return res.json({
        month,
        year,
        outstandingAmount,
        advanceAmount,
        monthDueAmount,
        netPayableAmount,
      });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch owner billing summary' });
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
    query('billKind').optional().isIn(BILL_KINDS as unknown as string[]),
    query('flatId').optional().isUUID(),
    query('ownerView').optional().isBoolean(),
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
      if (req.query.billKind) where.billKind = req.query.billKind;
      if (req.query.flatId) where.flatId = req.query.flatId;
      const ownerViewRequested = req.query.ownerView === 'true';

      // Safety fallback: if admin/super-admin does not send month/year,
      // default to current month to avoid heavy full-history scans.
      if (
        (req.user!.role === 'SUPER_ADMIN' || req.user!.role === 'ADMIN')
        && !ownerViewRequested
        && where.month === undefined
        && where.year === undefined
        && where.billKind === undefined
      ) {
        const now = new Date();
        where.month = now.getMonth() + 1;
        where.year = now.getFullYear();
      }

      timing.parseFiltersMs = nowMs() - parseStart;

      const scopeStart = nowMs();
      if (ownerViewRequested && [...FINANCIAL_ROLES].includes(req.user!.role as any)) {
        if (!req.user!.societyId) return res.json([]);

        const residentLookupStart = nowMs();
        const userFlatIds = await getUserOwnedFlatIds(req.user!.id, req.user!.societyId);
        timing.residentLookupMs = nowMs() - residentLookupStart;
        if (userFlatIds.length > 0) {
          Object.assign(where, buildResidentBillFilter(userFlatIds));
          where.flat = {
            ...(where.flat || {}),
            block: { societyId: req.user!.societyId },
          };
        } else {
          return res.json([]);
        }
      } else if (req.user!.role === 'SUPER_ADMIN' || [...FINANCIAL_ROLES].includes(req.user!.role as any)) {
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

      if (isAdminRole && societyId && !ownerViewRequested) {
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
        if (where.billKind) {
          params.push(where.billKind);
          conditions.push(`b."billKind"::text = $${params.length}`);
        }
        if (where.flatId) {
          params.push(where.flatId);
          conditions.push(`b."flatId" = $${params.length}`);
        }

        const sql = `
          SELECT
            b.id, b."flatId", b.month, b.year,
            b."billKind", b.title, b.description, b."appliesToMonth", b."appliesToYear",
            b."totalAmount", b."paidAmount", b.status, b."dueDate",
            f."flatNumber",
            bl.name AS "blockName",
            o.name AS "ownerName", o.phone AS "ownerPhone"
          FROM maintenance_bills b
          JOIN flats f ON f.id = b."flatId"
          JOIN blocks bl ON bl.id = f."blockId"
          LEFT JOIN owners o ON o."flatId" = f.id
          WHERE ${conditions.join(' AND ')}
          ORDER BY b."dueDate" DESC, b."createdAt" DESC
        `;

        const rows: any[] = await prisma.$queryRawUnsafe(sql, ...params);

        payload = rows.map((r) => ({
          id: r.id,
          flatId: r.flatId,
          month: r.month,
          year: r.year,
          billKind: r.billKind,
          title: r.title,
          description: r.description,
          appliesToMonth: r.appliesToMonth,
          appliesToYear: r.appliesToYear,
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
          orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
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
        lineItems: { orderBy: { sortOrder: 'asc' } },
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
      const societySettings = await prisma.societySettings.findUnique({
        where: { societyId: bill.flat.block.societyId },
      });

      const flatBills = await prisma.maintenanceBill.findMany({
        where: { flatId: bill.flatId },
        orderBy: [{ year: 'asc' }, { month: 'asc' }],
      });
      const totalOutstanding = Number(
        flatBills.reduce((sum, currentBill) => sum + Math.max(0, currentBill.totalAmount - currentBill.paidAmount), 0).toFixed(2),
      );

      if (societySettings?.partialPaymentAllowed === false && amount < totalOutstanding) {
        return res.status(400).json({ error: 'Partial payments are disabled for this association' });
      }

      if (societySettings?.advancePaymentAllowed === false && amount > totalOutstanding) {
        return res.status(400).json({ error: 'Advance payments are disabled for this association' });
      }

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

      await allocatePayment(bill.flatId, amount);

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
              billMonth: buildBillPeriodText(fullBill),
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

      notifyPaymentSuccess(payment.id).catch(() => {});

      const refreshedBill = await prisma.maintenanceBill.findUnique({ where: { id: bill.id } });
      return res.json({ payment, newStatus: refreshedBill?.status, paidAmount: refreshedBill?.paidAmount });
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

async function getUserOwnedFlatIds(userId: string, societyId: string) {
  const owners = await prisma.owner.findMany({
    where: { userId, flat: { block: { societyId } } },
    select: { flatId: true },
  });

  return [...new Set(owners.map((owner) => owner.flatId))];
}

export default router;
