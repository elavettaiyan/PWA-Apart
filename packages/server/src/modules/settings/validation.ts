import { body, param } from 'express-validator';
import { ASSIGNABLE_ROLES, CONFIGURABLE_MENU_ROLES } from './service';

const FLAT_TYPES = ['ONE_BHK', 'TWO_BHK', 'THREE_BHK', 'FOUR_BHK', 'STUDIO', 'PENTHOUSE', 'SHOP', 'OTHER'] as const;

export const menuVisibilityValidation = [
  param('role').isIn([...CONFIGURABLE_MENU_ROLES]).withMessage('Invalid role'),
  body('visibleMenuIds').isArray().withMessage('visibleMenuIds must be an array'),
];

export const paymentGatewayValidation = [
  body('merchantId').isString().notEmpty().withMessage('Merchant ID is required'),
  body('clientId').optional({ values: 'falsy' }).isString(),
  body('clientSecret').optional({ values: 'falsy' }).isString(),
  body('clientVersion').optional().isInt({ min: 1 }),
  body('saltKey').optional({ values: 'falsy' }).isString(),
  body('saltIndex').optional().isInt({ min: 1 }),
  body('environment').isIn(['UAT', 'PRODUCTION']).withMessage('Environment must be UAT or PRODUCTION'),
  body('redirectUrl').optional({ values: 'falsy' }).isURL({ require_tld: false }),
  body('callbackUrl').optional({ values: 'falsy' }).isURL({ require_tld: false }),
];

export const memberRoleValidation = [
  param('userId').isUUID(),
  body('role').isIn([...ASSIGNABLE_ROLES]).withMessage('Invalid role'),
];

export const memberUserIdValidation = [param('userId').isUUID()];

export const removeMemberValidation = [
  param('userId').isUUID(),
  body('reason').trim().notEmpty().withMessage('Reason is required'),
];

export const communityProfileValidation = [
  body('name').optional().trim().notEmpty().withMessage('Community name cannot be empty'),
  body('communityType').optional().isIn(['APARTMENT', 'VILLA', 'GATED_COMMUNITY', 'TOWNSHIP']).withMessage('Invalid community type'),
  body('address').optional().trim().notEmpty().withMessage('Address cannot be empty'),
  body('city').optional().trim().notEmpty().withMessage('City cannot be empty'),
  body('state').optional().trim().notEmpty().withMessage('State cannot be empty'),
  body('pincode').optional().trim().matches(/^\d{6}$/).withMessage('Pincode must be 6 digits'),
  body('totalUnits').optional({ nullable: true }).isInt({ min: 0 }).withMessage('Total units must be a non-negative integer'),
];

export const societySettingsValidation = [
  body('societyId').optional().isUUID(),
  body('lateFeeEnabled').optional().isBoolean(),
  body('lateFeeMode').optional().isIn(['PER_DAY', 'ONE_TIME_PER_BILL', 'RECURRING']),
  body('recurringLateFeeFrequency').optional().isIn(['DAILY', 'MONTHLY']),
  body('gracePeriodDays').optional().isInt({ min: 0 }),
  body('dueDay').optional().isInt({ min: 1, max: 28 }),
  body('committeeMemberLimit').optional().isInt({ min: 0 }),
  body('partialPaymentAllowed').optional().isBoolean(),
  body('advancePaymentAllowed').optional().isBoolean(),
  body('autoAdjustAdvance').optional().isBoolean(),
  body('supportsPets').optional().isBoolean(),
  body('configuredFlatTypes').optional().isArray(),
  body('configuredFlatTypes.*').optional().isIn([...FLAT_TYPES]),
];

export const runLateFeesValidation = [body('societyId').optional().isUUID()];