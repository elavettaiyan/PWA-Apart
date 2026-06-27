import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest, FINANCIAL_ROLES } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { upload, getFileUrl } from '../../middleware/upload';
import { sendCreated, sendOk } from '../../lib/http';
import { canAccessExpense } from './permissions';
import { createExpense, deleteExpense, findExpenseById, hasInvalidAccountingPeriodPair, listExpenses, updateExpense } from './service';
import { createExpenseValidation, expenseIdValidation, listExpensesValidation, updateExpenseValidation } from './validation';

const router = Router();
router.use(authenticate);

// ── GET ALL EXPENSES ────────────────────────────────────
router.get(
  '/',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  listExpensesValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const month = req.query.month ? Number(req.query.month) : undefined;
      const year = req.query.year ? Number(req.query.year) : undefined;

      if ((month && !year) || (!month && year)) {
        return res.status(400).json({ error: 'Month and year must be provided together' });
      }

      const result = await listExpenses({ societyId: req.user!.societyId, query: req.query });

      return sendOk(res, result);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch expenses' });
    }
  },
);

// ── GET SINGLE EXPENSE ──────────────────────────────────
router.get('/:id', authorize('SUPER_ADMIN', ...FINANCIAL_ROLES), expenseIdValidation, validate, async (req: AuthRequest, res: Response) => {
  try {
    const expense = await findExpenseById(req.params.id);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    if (!canAccessExpense(req.user!, expense)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return sendOk(res, expense);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch expense' });
  }
});

// ── CREATE EXPENSE ──────────────────────────────────────
router.post(
  '/',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  upload.single('receipt'),
  createExpenseValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      if (hasInvalidAccountingPeriodPair(req.body)) {
        return res.status(400).json({ error: 'Accounting month and year must be provided together' });
      }

      const receiptUrl = req.file ? getFileUrl(req.file) : null;
      const expense = await createExpense({
        societyId: req.user!.societyId!,
        approvedBy: req.user!.id,
        body: req.body,
        receiptUrl,
      });

      return sendCreated(res, expense);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create expense' });
    }
  },
);

// ── UPDATE EXPENSE ──────────────────────────────────────
router.put(
  '/:id',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  updateExpenseValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;

      if (hasInvalidAccountingPeriodPair(req.body)) {
        return res.status(400).json({ error: 'Accounting month and year must be provided together' });
      }

      const existing = await findExpenseById(id);
      if (!existing) return res.status(404).json({ error: 'Expense not found' });
      if (!canAccessExpense(req.user!, existing)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const expense = await updateExpense(id, existing, req.body);
      return sendOk(res, expense);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update expense' });
    }
  },
);

// ── DELETE EXPENSE ──────────────────────────────────────
router.delete(
  '/:id',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  expenseIdValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const existing = await findExpenseById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Expense not found' });
      if (!canAccessExpense(req.user!, existing)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      await deleteExpense(req.params.id);
      return sendOk(res, { message: 'Expense deleted successfully' });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to delete expense' });
    }
  },
);

export default router;
