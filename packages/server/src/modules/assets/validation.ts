import { body, param, query } from 'express-validator';

export const ASSET_TYPES = ['LIFT', 'WATER_TANK', 'TOILET', 'AUDITORIUM', 'SEPTIC_TANK', 'GARDEN', 'GENERATOR', 'PUMP', 'FIRE_SAFETY', 'OTHER'] as const;
const SERVICE_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'CUSTOM'] as const;
const JOB_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'POSTPONED', 'RESCHEDULED'] as const;
const JOB_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;

export const listAssetsValidation = [
  query('type').optional().isIn([...ASSET_TYPES]),
  query('blockId').optional().isUUID(),
  query('active').optional().isIn(['true', 'false']),
];

export const assetIdValidation = [param('id').isUUID()];

export const createAssetValidation = [
  body('name').trim().notEmpty(),
  body('type').isIn([...ASSET_TYPES]),
  body('location').optional({ values: 'falsy' }).trim(),
  body('blockId').optional({ values: 'falsy' }).isUUID(),
  body('description').optional({ values: 'falsy' }).trim(),
  body('installationDate').optional({ values: 'falsy' }).isISO8601(),
  body('vendor').optional({ values: 'falsy' }).trim(),
  body('serviceContact').optional({ values: 'falsy' }).trim(),
  body('periodicServiceRequired').optional({ values: 'falsy' }).isIn(['true', 'false']),
  body('serviceFrequency').optional({ values: 'falsy' }).isIn([...SERVICE_FREQUENCIES]),
  body('serviceIntervalDays').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('lastServiceDate').optional({ values: 'falsy' }).isISO8601(),
  body('nextServiceDate').optional({ values: 'falsy' }).isISO8601(),
  body('serviceVendor').optional({ values: 'falsy' }).trim(),
  body('serviceCost').optional({ values: 'falsy' }).isFloat({ min: 0 }),
  body('serviceNotes').optional({ values: 'falsy' }).trim(),
];

export const updateAssetValidation = [
  param('id').isUUID(),
  body('name').optional().trim().notEmpty(),
  body('type').optional({ values: 'falsy' }).isIn([...ASSET_TYPES]),
  body('location').optional({ values: 'falsy' }).trim(),
  body('blockId').optional({ values: 'falsy' }),
  body('description').optional({ values: 'falsy' }).trim(),
  body('installationDate').optional({ values: 'falsy' }).isISO8601(),
  body('vendor').optional({ values: 'falsy' }).trim(),
  body('serviceContact').optional({ values: 'falsy' }).trim(),
  body('periodicServiceRequired').optional({ values: 'falsy' }).isIn(['true', 'false']),
  body('serviceFrequency').optional({ values: 'falsy' }).isIn([...SERVICE_FREQUENCIES]),
  body('serviceIntervalDays').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('lastServiceDate').optional({ values: 'falsy' }).isISO8601(),
  body('nextServiceDate').optional({ values: 'falsy' }).isISO8601(),
  body('serviceVendor').optional({ values: 'falsy' }).trim(),
  body('serviceCost').optional({ values: 'falsy' }).isFloat({ min: 0 }),
  body('serviceNotes').optional({ values: 'falsy' }).trim(),
  body('isActive').optional({ values: 'falsy' }).isIn(['true', 'false']),
  body('existingImages').optional({ values: 'falsy' }).isString(),
];

export const listJobsValidation = [
  query('status').optional().isIn([...JOB_STATUSES]),
  query('assetId').optional().isUUID(),
  query('priority').optional().isIn([...JOB_PRIORITIES]),
];

export const createJobValidation = [
  body('assetId').isUUID(),
  body('jobType').optional().trim(),
  body('scheduledDate').isISO8601(),
  body('assignedTo').optional().trim(),
  body('assignedToUserId').optional().isUUID(),
  body('priority').optional().isIn([...JOB_PRIORITIES]),
  body('remarks').optional().trim(),
];

export const updateJobStatusValidation = [
  param('id').isUUID(),
  body('status').isIn([...JOB_STATUSES]),
  body('remarks').optional().trim(),
  body('completedDate').optional().isISO8601(),
  body('scheduledDate').optional().isISO8601(),
  body('invoiceUrl').optional().trim(),
  body('cost').optional().isFloat({ min: 0 }),
  body('vendor').optional().trim(),
];

export const jobIdValidation = [param('id').isUUID()];

export const historyAssetIdValidation = [param('assetId').isUUID()];

export const createHistoryValidation = [
  body('assetId').isUUID(),
  body('serviceDate').isISO8601(),
  body('vendor').optional().trim(),
  body('notes').optional().trim(),
  body('cost').optional().isFloat({ min: 0 }),
  body('invoiceUrl').optional().trim(),
];