import { body, param, query } from 'express-validator';

export const listCrmSocietiesValidation = [
  query('search').optional().trim(),
  query('status').optional().isIn(['active', 'inactive']),
  query('premium').optional().isIn(['true', 'false', 'trial', 'override']),
];

export const crmSocietyIdValidation = [param('id').isUUID()];

export const updateCrmSocietyStatusValidation = [
  param('id').isUUID(),
  body('isActive').isBoolean(),
];

export const updateCrmTrialValidation = [
  param('id').isUUID(),
  body('trialEndsAt').isISO8601(),
];

export const updateCrmPremiumOverrideValidation = [
  param('id').isUUID(),
  body('premiumOverrideUntil').optional({ nullable: true }).isISO8601(),
];

export const updateCrmMetaValidation = [
  param('id').isUUID(),
  body('crmNotes').optional({ nullable: true }).isString(),
  body('crmTags').optional().isArray(),
  body('crmTags.*').optional().isString().trim().notEmpty(),
];

export const crmPaymentsValidation = [
  param('id').isUUID(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];

export const sendCampaignMailValidation = [
  body('targetMode').isIn(['all', 'specific']),
  body('subject').trim().notEmpty().withMessage('Subject is required'),
  body('html').isString().trim().notEmpty().withMessage('HTML message is required'),
  body('recipientEmails').optional().isArray({ min: 1 }).withMessage('Recipient emails must be a non-empty array'),
  body('recipientEmails.*').optional().isEmail().withMessage('Each recipient email must be valid').normalizeEmail({ gmail_remove_dots: false }),
];

export const campaignMailHistoryValidation = [query('limit').optional().isInt({ min: 1, max: 100 }).toInt()];

export const deleteCrmUserValidation = [param('userId').isUUID()];