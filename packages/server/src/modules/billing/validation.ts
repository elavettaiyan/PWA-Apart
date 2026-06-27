import { body, param, query } from 'express-validator';
import { ALL_FLAT_TYPES, BILL_KINDS, BILL_LINE_ITEM_CATEGORIES, CUSTOM_BILLING_MODES } from './service';

export const configValidation = [
  body('societyId').isUUID(),
  body('flatType').optional().isIn([...ALL_FLAT_TYPES]),
  body('baseAmount').isFloat({ min: 0 }),
  body('waterCharge').optional().isFloat({ min: 0 }),
  body('parkingCharge').optional().isFloat({ min: 0 }),
  body('sinkingFund').optional().isFloat({ min: 0 }),
  body('repairFund').optional().isFloat({ min: 0 }),
  body('otherCharges').optional().isFloat({ min: 0 }),
  body('lateFeePerDay').optional().isFloat({ min: 0 }),
  body('lateFeeAmount').optional().isFloat({ min: 0 }),
  body('recurringLateFeeAmount').optional().isFloat({ min: 0 }),
];

export const generateBillsValidation = [
  body('societyId').isUUID(),
  body('month').isInt({ min: 1, max: 12 }),
  body('year').isInt({ min: 2020 }),
];

export const customBillValidation = [
  body('mode').isIn([...CUSTOM_BILLING_MODES]),
  body('amount').isFloat({ min: 1 }),
  body('flatId').optional().isUUID(),
  body('title').optional().isString().isLength({ min: 1, max: 120 }),
  body('description').optional().isString().isLength({ max: 500 }),
  body('notes').optional().isString().isLength({ max: 1000 }),
  body('appliesToMonth').optional().isInt({ min: 1, max: 12 }),
  body('appliesToYear').optional().isInt({ min: 2020 }),
];

export const ownerSummaryValidation = [
  query('month').optional().isInt({ min: 1, max: 12 }),
  query('year').optional().isInt({ min: 2020 }),
];

export const lateFeeRunsValidation = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('success').optional().isIn(['true', 'false']),
  query('triggerSource').optional().isIn(['MANUAL', 'SCHEDULED']),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
];

export const listBillsValidation = [
  query('month').optional().isInt({ min: 1, max: 12 }),
  query('year').optional().isInt({ min: 2020 }),
  query('status').optional().isIn(['PENDING', 'PARTIAL', 'PAID', 'OVERDUE']),
  query('billKind').optional().isIn([...BILL_KINDS]),
  query('flatId').optional().isUUID(),
  query('ownerView').optional().isBoolean(),
];

export const billIdValidation = [param('id').isUUID()];

export const manualPaymentValidation = [
  param('id').isUUID(),
  body('amount').isFloat({ min: 1 }),
  body('method').isIn(['CASH', 'CHEQUE', 'BANK_TRANSFER', 'UPI_OTHER']),
];

export { BILL_LINE_ITEM_CATEGORIES };