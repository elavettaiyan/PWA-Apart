import { body, param, query } from 'express-validator';

export const listSurveysValidation = [query('societyId').optional().isUUID()];

export const createSurveyValidation = [
  body('societyId').optional().isUUID(),
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('description').optional({ values: 'falsy' }).isString(),
  body('allowMultipleVotes').optional().isBoolean(),
  body('closesAt').isISO8601().withMessage('A valid closing date and time is required'),
  body('options').isArray({ min: 2 }).withMessage('At least two options are required'),
  body('options.*.label').trim().notEmpty().withMessage('Option label is required'),
];

export const voteSurveyValidation = [
  param('id').isUUID(),
  body('optionIds').isArray({ min: 1 }).withMessage('Select at least one option'),
  body('optionIds.*').isUUID(),
];

export const surveyIdValidation = [param('id').isUUID()];