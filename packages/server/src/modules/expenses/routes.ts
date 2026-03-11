import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { upload } from '../../middleware/upload';

const router = Router();
router.use(authenticate);

// ── GET ALL EXPENSES ────────────────────────────────────
router.get(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [
    query('category').optional().isString(),
    query('fromDate').optional().isISO8601(),
    query('toDate').optional().isISO8601(),
  ],
  validate,
  async (req: AuthRequest, res) => {
    try {
      const where: any = {};

      if (req.user!.societyId) where.societyId = req.user!.societyId;
      if (req.query.category) where.category = req.query.category;

      if (req.query.fromDate || req.query.toDate) {
        where.expenseDate = {};
        if (req.query.fromDate) where.expenseDate.gte = new Date(req.query.fromDate as string);
        if (req.query.toDate) where.expenseDate.lte = new Date(req.query.toDate as string);
      }

      const expenses = await prisma.expense.findMany({
        where,
        orderBy: { expenseDate: 'desc' },
      });

      // Get summary
      const summary = await prisma.expense.groupBy({
        by: ['category'],
        where,
        _sum: { amount: true },
        _count: true,
      });

      const total = expenses.reduce((sum, e) => sum + e.amount, 0);

      return res.json({ expenses, summary, total });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch expenses' });
    }
  },
);

// ── GET SINGLE EXPENSE ──────────────────────────────────
router.get('/:id', authorize('SUPER_ADMIN', 'ADMIN'), [param('id').isUUID()], validate, async (req: AuthRequest, res) => {
  try {
    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
    });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    return res.json(expense);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch expense' });
  }
});

// ── CREATE EXPENSE ──────────────────────────────────────
router.post(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN'),
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
  ],
  validate,
  async (req: AuthRequest, res) => {
    try {
      const receiptUrl = req.file ? `/uploads/${req.file.filename}` : null;

      const expense = await prisma.expense.create({
        data: {
          societyId: req.user!.societyId!,
          category: req.body.category,
          amount: parseFloat(req.body.amount),
          description: req.body.description,
          vendor: req.body.vendor || null,
          receiptUrl,
          expenseDate: new Date(req.body.expenseDate),
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
  authorize('SUPER_ADMIN', 'ADMIN'),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const expense = await prisma.expense.update({
        where: { id },
        data: {
          ...req.body,
          amount: req.body.amount ? parseFloat(req.body.amount) : undefined,
          expenseDate: req.body.expenseDate ? new Date(req.body.expenseDate) : undefined,
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
  authorize('SUPER_ADMIN', 'ADMIN'),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res) => {
    try {
      await prisma.expense.delete({ where: { id: req.params.id } });
      return res.json({ message: 'Expense deleted successfully' });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to delete expense' });
    }
  },
);

export default router;
