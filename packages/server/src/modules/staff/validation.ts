import { body, param } from 'express-validator';

const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

function normalizeIndianMobileNumber(value: string) {
  return String(value || '').replace(/\D/g, '').slice(-10);
}

export const createStaffValidation = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('phone')
    .trim()
    .customSanitizer(normalizeIndianMobileNumber)
    .matches(INDIAN_MOBILE_REGEX)
    .withMessage('Phone must be a valid 10-digit Indian mobile number'),
  body('specialization').optional().isString(),
  body('password').optional({ values: 'falsy' }).isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
];

export const updateStaffValidation = [
  param('id').isUUID(),
  body('name').optional().trim().notEmpty(),
  body('phone').optional({ values: 'falsy' }).isMobilePhone('en-IN'),
  body('specialization').optional().isString(),
  body('isActive').optional().isBoolean(),
];