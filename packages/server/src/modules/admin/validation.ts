import { body, param } from 'express-validator';

export const deleteSocietyValidation = [
  param('id').isUUID(),
  body('confirmationName').trim().notEmpty(),
];