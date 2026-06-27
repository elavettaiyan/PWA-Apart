import { body, param, query } from 'express-validator';
import { COMPLAINT_ACTIONS, COMPLAINT_ESCALATION_LEVELS, COMPLAINT_STATUSES } from './service';

export const listComplaintsValidation = [
  query('status').optional().isIn([...COMPLAINT_STATUSES]),
  query('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  query('category').optional().isString(),
  query('ownerView').optional().isBoolean(),
  query('minPendingDays').optional().isInt({ min: 1 }),
];

export const complaintIdValidation = [param('id').isUUID()];

export const createComplaintValidation = [
  body('title').trim().notEmpty(),
  body('description').trim().notEmpty(),
  body('category').trim().notEmpty(),
  body('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  body('flatId').optional().isUUID(),
];

export const updateComplaintStatusValidation = [
  param('id').isUUID(),
  body('status').isIn([...COMPLAINT_STATUSES]),
  body('assignedToId').optional().isUUID(),
  body('resolution').optional().isString(),
];

export const updateComplaintCategoryValidation = [
  param('id').isUUID(),
  body('category').trim().notEmpty(),
];

export const updateComplaintResolutionValidation = [
  param('id').isUUID(),
  body('resolution').isString(),
];

export const complaintActionValidation = [
  param('id').isUUID(),
  body('action').isIn([...COMPLAINT_ACTIONS]),
  body('assignedToId').optional().isUUID(),
  body('resolution').optional().isString(),
];

export const escalateComplaintValidation = [
  param('id').isUUID(),
  body('reason').trim().notEmpty(),
  body('targetLevel').optional().isIn([...COMPLAINT_ESCALATION_LEVELS]),
];

export const addComplaintCommentValidation = [
  param('id').isUUID(),
  body('content').trim().notEmpty(),
];