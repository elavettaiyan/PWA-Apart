import { body, query } from 'express-validator';

export const initiatePhonePePaymentValidation = [
  body('billId').isUUID(),
  body('nativeSdk').optional().isBoolean(),
];

export const initiatePhonePeAmountValidation = [
  body('flatId').isUUID(),
  body('amount').isFloat({ gt: 0 }),
  body('nativeSdk').optional().isBoolean(),
];

export const initiateBulkPhonePePaymentValidation = [
  body('billIds').isArray({ min: 2 }).withMessage('At least two bills are required for bulk payment'),
  body('nativeSdk').optional().isBoolean(),
];

export const phonePeSdkConfirmValidation = [
  body('merchantTransId').isString().notEmpty(),
  body('transactionId').optional().isString(),
  body('state').optional().isString(),
];

export const paymentHistoryValidation = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('status').optional().isString(),
  query('method').optional().isString(),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('ownerView').optional().isIn(['true', 'false']),
];

export const paymentReportValidation = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 500 }).toInt(),
  query('status').optional().isString(),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('export').optional().isString(),
  query('ownerView').optional().isIn(['true', 'false']),
];