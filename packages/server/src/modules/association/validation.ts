import { body, param } from 'express-validator';

export const bylawIdValidation = [param('id').isUUID()];

export const createBylawValidation = [
  body('title').trim().notEmpty(),
  body('content').trim().notEmpty(),
  body('category').trim().notEmpty(),
  body('penaltyAmount').optional().isFloat({ min: 0 }),
  body('effectiveDate').optional().isISO8601(),
];