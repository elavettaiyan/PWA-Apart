import { body, param, query } from 'express-validator';

const DELIVERY_TYPES = ['COURIER', 'FOOD', 'GROCERY', 'MEDICINE', 'PARCEL', 'OTHER'] as const;

export const listDeliveriesValidation = [
  query('deliveryType').optional().isIn(DELIVERY_TYPES),
  query('flatId').optional().isUUID(),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('ownerView').optional().isBoolean(),
];

export const createDeliveryValidation = [
  body('flatId').isUUID(),
  body('deliveryType').isIn(DELIVERY_TYPES),
  body('deliveryPersonName').trim().notEmpty(),
  body('mobile').trim().notEmpty(),
  body('companyName').optional({ values: 'falsy' }).isString(),
  body('vehicleNumber').optional({ values: 'falsy' }).isString(),
  body('notes').optional({ values: 'falsy' }).isString(),
];

export const updateDeliveryReadStateValidation = [
  param('id').isUUID(),
  body('isRead').isBoolean().withMessage('isRead must be a boolean'),
];