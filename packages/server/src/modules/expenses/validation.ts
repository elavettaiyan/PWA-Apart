import { body, param, query } from 'express-validator';

const EXPENSE_CATEGORIES = [
  'MAINTENANCE', 'REPAIR', 'SALARY', 'ELECTRICITY', 'WATER',
  'SECURITY', 'CLEANING', 'GARDENING', 'LIFT', 'SINKING_FUND',
  'INSURANCE', 'LEGAL', 'EVENTS', 'OTHER',
] as const;

export const listExpensesValidation = [
  query('category').optional().isString(),
  query('month').optional().isInt({ min: 1, max: 12 }),
  query('year').optional().isInt({ min: 2020, max: 2100 }),
  query('fromDate').optional().isISO8601(),
  query('toDate').optional().isISO8601(),
];

export const expenseIdValidation = [param('id').isUUID()];

export const createExpenseValidation = [
  body('category').isIn(EXPENSE_CATEGORIES),
  body('amount').isFloat({ min: 0.01 }),
  body('description').trim().notEmpty(),
  body('expenseDate').isISO8601(),
  body('accountingMonth').optional().isInt({ min: 1, max: 12 }),
  body('accountingYear').optional().isInt({ min: 2020, max: 2100 }),
];

export const updateExpenseValidation = [
  param('id').isUUID(),
  body('accountingMonth').optional().isInt({ min: 1, max: 12 }),
  body('accountingYear').optional().isInt({ min: 2020, max: 2100 }),
  body('expenseDate').optional().isISO8601(),
];