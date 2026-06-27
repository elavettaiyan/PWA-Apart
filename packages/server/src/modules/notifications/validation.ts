import { body, query } from 'express-validator';

const BROADCAST_ROLES = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER', 'OWNER', 'TENANT', 'SERVICE_STAFF'] as const;

export const recentNotificationsValidation = [
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

export const maintenanceReminderValidation = [
  body('societyId').optional().isUUID(),
  body('dueInDays').optional().isInt({ min: 0, max: 30 }),
];

export const announcementBroadcastValidation = [
  body('societyId').optional().isUUID(),
  body('title').isString().trim().notEmpty(),
  body('message').isString().trim().notEmpty(),
  body('path').optional().isString(),
  body('roles').optional().isArray(),
  body('roles.*').optional().isIn([...BROADCAST_ROLES]),
];