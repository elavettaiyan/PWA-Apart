import { body, param, query } from 'express-validator';

export const listEventsValidation = [
  query('societyId').optional().isUUID(),
  query('status').optional().isIn(['SCHEDULED', 'CANCELLED', 'COMPLETED']),
];

export const createEventValidation = [
  body('societyId').optional().isUUID(),
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('description').trim().notEmpty().withMessage('Description is required'),
  body('place').trim().notEmpty().withMessage('Place is required'),
  body('startAt').isISO8601().withMessage('Valid start date and time is required'),
  body('endAt').optional({ values: 'falsy' }).isISO8601().withMessage('Valid end date and time is required'),
];

export const updateEventValidation = [
  param('id').isUUID(),
  body('title').optional().trim().notEmpty(),
  body('description').optional().trim().notEmpty(),
  body('place').optional().trim().notEmpty(),
  body('startAt').optional().isISO8601(),
  body('endAt').optional({ values: 'falsy' }).isISO8601(),
  body('status').optional().isIn(['SCHEDULED', 'CANCELLED', 'COMPLETED']),
];

export const eventIdValidation = [param('id').isUUID()];

export const sendEventRemindersValidation = [body('societyId').optional().isUUID()];