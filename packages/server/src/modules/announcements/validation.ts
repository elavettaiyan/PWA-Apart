import { body, param, query } from 'express-validator';

export const listAnnouncementsValidation = [query('societyId').optional().isUUID()];

export const createAnnouncementValidation = [
  body('societyId').optional().isUUID(),
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('message').trim().notEmpty().withMessage('Message is required'),
  body('path').optional({ values: 'falsy' }).isString(),
];

export const announcementIdValidation = [param('id').isUUID()];

export const pinAnnouncementValidation = [
  param('id').isUUID(),
  body('isPinned').isBoolean().withMessage('isPinned must be a boolean'),
];

export const announcementReadStateValidation = [
  param('id').isUUID(),
  body('isRead').isBoolean().withMessage('isRead must be a boolean'),
];