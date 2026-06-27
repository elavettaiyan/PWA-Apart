import { ApprovalActionType, ApprovalStatus } from '@prisma/client';
import { body, param, query } from 'express-validator';

export const APPROVAL_ACTION_TYPES: ApprovalActionType[] = ['TENANT_REGISTRATION', 'TENANT_PROFILE_CHANGE'];
export const APPROVAL_STATUSES: ApprovalStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
const APPROVAL_ALLOWED_ROLES = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER', 'OWNER'] as const;

export const listApprovalsValidation = [
  query('societyId').optional().isUUID(),
  query('status').optional().isIn(APPROVAL_STATUSES),
  query('actionType').optional().isIn(APPROVAL_ACTION_TYPES),
];

export const approvalConfigValidation = [
  param('actionType').isIn(APPROVAL_ACTION_TYPES),
  query('societyId').optional().isUUID(),
];

export const approvalIdValidation = [
  param('id').isUUID(),
  query('societyId').optional().isUUID(),
];

export const approvalReadStateValidation = [
  param('id').isUUID(),
  body('isRead').isBoolean().withMessage('isRead must be a boolean'),
  query('societyId').optional().isUUID(),
];

export const updateApprovalConfigValidation = [
  param('actionType').isIn(APPROVAL_ACTION_TYPES),
  body('societyId').optional().isUUID(),
  body('enabled').isBoolean().withMessage('enabled must be a boolean'),
  body('approverRoles').optional().isArray().withMessage('approverRoles must be an array'),
  body('approverRoles.*').optional().isIn([...APPROVAL_ALLOWED_ROLES]).withMessage('Invalid approver role'),
];

export const resolveApprovalValidation = [
  param('id').isUUID(),
  body('societyId').optional().isUUID(),
  body('comment').optional({ values: 'falsy' }).trim().isLength({ max: 500 }).withMessage('Comment is too long'),
];