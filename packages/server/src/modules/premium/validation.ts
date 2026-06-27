import { body } from 'express-validator';

export const subscribeValidation = [body('requestedFlatCount').optional().isInt({ min: 1 })];

export const upgradeValidation = [body('requestedFlatCount').isInt({ min: 1 })];

export const verifyPremiumPaymentValidation = [
  body('razorpay_payment_id').trim().notEmpty(),
  body('razorpay_subscription_id').trim().notEmpty(),
  body('razorpay_signature').trim().notEmpty(),
];