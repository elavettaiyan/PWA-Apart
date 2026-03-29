import { Router, Response } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest, FINANCIAL_ROLES } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { upload, getFileUrl } from '../../middleware/upload';

const router = Router();
router.use(authenticate);

function getAccountingPeriodFromDate(date: Date) {
  return {
    accountingMonth: date.getMonth() + 1,
    accountingYear: date.getFullYear(),
  };
}

function getMonthDateRange(month: number, year: number) {
  return {
    fromDate: new Date(year, month - 1, 1),
    toDate: new Date(year, month, 0, 23, 59, 59, 999),
  };
}

function getAccountingPeriodLabel(month: number, year: number) {
  return new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1));
}

// ── GET ALL EXPENSES ────────────────────────────────────
router.get(
  '/',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  [
    query('category').optional().isString(),
    query('month').optional().isInt({ min: 1, max: 12 }),
    query('year').optional().isInt({ min: 2020, max: 2100 }),
    query('fromDate').optional().isISO8601(),
    query('toDate').optional().isISO8601(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const where: any = {};
      const month = req.query.month ? Number(req.query.month) : undefined;
      const year = req.query.year ? Number(req.query.year) : undefined;

      if (req.user!.societyId) where.societyId = req.user!.societyId;
      if (req.query.category) where.category = req.query.category;

      if ((month && !year) || (!month && year)) {
        return res.status(400).json({ error: 'Month and year must be provided together' });
      }

      if (month && year) {
        where.accountingMonth = month;
        where.accountingYear = year;
      }

      if (req.query.fromDate || req.query.toDate) {
        where.expenseDate = {};
        if (req.query.fromDate) where.expenseDate.gte = new Date(req.query.fromDate as string);
        if (req.query.toDate) where.expenseDate.lte = new Date(req.query.toDate as string);
      }

      const expenses = await prisma.expense.findMany({
        where,
        orderBy: [
          { accountingYear: 'desc' },
          { accountingMonth: 'desc' },
          { expenseDate: 'desc' },
        ],
      });

      // Get summary
      const summary = await prisma.expense.groupBy({
        by: ['category'],
        where,
        _sum: { amount: true },
        _count: true,
      });

      const total = expenses.reduce((sum, e) => sum + e.amount, 0);

      return res.json({
        expenses,
        summary,
        total,
        selectedPeriod: month && year
          ? {
            accountingMonth: month,
            accountingYear: year,
            label: getAccountingPeriodLabel(month, year),
            ...getMonthDateRange(month, year),
          }
          : null,
      });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch expenses' });
    }
  },
);

// ── GET SINGLE EXPENSE ──────────────────────────────────
router.get('/:id', authorize('SUPER_ADMIN', ...FINANCIAL_ROLES), [param('id').isUUID()], validate, async (req: AuthRequest, res: Response) => {
  try {
    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
    });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    // SECURITY: Verify expense belongs to admin's society
    if (req.user!.role !== 'SUPER_ADMIN' && expense.societyId !== req.user!.societyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.json(expense);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch expense' });
  }
});

// ── CREATE EXPENSE ──────────────────────────────────────
router.post(
  '/',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  upload.single('receipt'),
  [
    body('category').isIn([
      'MAINTENANCE', 'REPAIR', 'SALARY', 'ELECTRICITY', 'WATER',
      'SECURITY', 'CLEANING', 'GARDENING', 'LIFT', 'SINKING_FUND',
      'INSURANCE', 'LEGAL', 'EVENTS', 'OTHER',
    ]),
    body('amount').isFloat({ min: 0.01 }),
    body('description').trim().notEmpty(),
    body('expenseDate').isISO8601(),
    body('accountingMonth').optional().isInt({ min: 1, max: 12 }),
    body('accountingYear').optional().isInt({ min: 2020, max: 2100 }),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      if ((req.body.accountingMonth && !req.body.accountingYear) || (!req.body.accountingMonth && req.body.accountingYear)) {
        return res.status(400).json({ error: 'Accounting month and year must be provided together' });
      }

      const receiptUrl = req.file ? getFileUrl(req.file) : null;
      const expenseDate = new Date(req.body.expenseDate);
      const accountingPeriod = req.body.accountingMonth && req.body.accountingYear
        ? {
          accountingMonth: Number(req.body.accountingMonth),
          accountingYear: Number(req.body.accountingYear),
        }
        : getAccountingPeriodFromDate(expenseDate);

      const expense = await prisma.expense.create({
        data: {
          societyId: req.user!.societyId!,
          category: req.body.category,
          amount: parseFloat(req.body.amount),
          description: req.body.description,
          vendor: req.body.vendor || null,
          receiptUrl,
          expenseDate,
          accountingMonth: accountingPeriod.accountingMonth,
          accountingYear: accountingPeriod.accountingYear,
          approvedBy: req.user!.id,
        },
      });

      return res.status(201).json(expense);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create expense' });
    }
  },
);

// ── UPDATE EXPENSE ──────────────────────────────────────
router.put(
  '/:id',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  [
    param('id').isUUID(),
    body('accountingMonth').optional().isInt({ min: 1, max: 12 }),
    body('accountingYear').optional().isInt({ min: 2020, max: 2100 }),
    body('expenseDate').optional().isISO8601(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;

      if ((req.body.accountingMonth && !req.body.accountingYear) || (!req.body.accountingMonth && req.body.accountingYear)) {
        return res.status(400).json({ error: 'Accounting month and year must be provided together' });
      }

      // SECURITY: Verify expense belongs to admin's society
      const existing = await prisma.expense.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: 'Expense not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && existing.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const expenseDate = req.body.expenseDate ? new Date(req.body.expenseDate) : existing.expenseDate;
      const accountingPeriod = req.body.accountingMonth && req.body.accountingYear
        ? {
          accountingMonth: Number(req.body.accountingMonth),
          accountingYear: Number(req.body.accountingYear),
        }
        : {
          accountingMonth: existing.accountingMonth,
          accountingYear: existing.accountingYear,
        };

      // SECURITY: Whitelist allowed fields
      const expense = await prisma.expense.update({
        where: { id },
        data: {
          category: req.body.category,
          amount: req.body.amount ? parseFloat(req.body.amount) : undefined,
          description: req.body.description,
          vendor: req.body.vendor,
          expenseDate: req.body.expenseDate ? expenseDate : undefined,
          accountingMonth: req.body.accountingMonth || req.body.accountingYear || req.body.expenseDate
            ? accountingPeriod.accountingMonth
            : undefined,
          accountingYear: req.body.accountingMonth || req.body.accountingYear || req.body.expenseDate
            ? accountingPeriod.accountingYear
            : undefined,
        },
      });
      return res.json(expense);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update expense' });
    }
  },
);

// ── DELETE EXPENSE ──────────────────────────────────────
router.delete(
  '/:id',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // SECURITY: Verify expense belongs to admin's society
      const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Expense not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && existing.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      await prisma.expense.delete({ where: { id: req.params.id } });
      return res.json({ message: 'Expense deleted successfully' });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to delete expense' });
    }
  },
);

export default router;
