import { body, param, query } from 'express-validator';

const VISITOR_PURPOSES = ['Guest', 'Family Visit', 'Friend Visit', 'Maintenance', 'Official', 'Other'] as const;

export const listVisitorsValidation = [
  query('status').optional().isIn(['ACTIVE', 'LEFT']),
  query('flatId').optional().isUUID(),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('ownerView').optional().isBoolean(),
];

export const createVisitorValidation = [
  body('flatId').isUUID(),
  body('visitorName').trim().notEmpty(),
  body('mobile').trim().notEmpty(),
  body('purpose').isIn(VISITOR_PURPOSES),
  body('vehicleNumber').optional({ values: 'falsy' }).isString(),
  body('notes').optional({ values: 'falsy' }).isString(),
];

export const checkoutVisitorValidation = [
  param('id').isUUID(),
  body('checkedOutAt').optional().isISO8601(),
];