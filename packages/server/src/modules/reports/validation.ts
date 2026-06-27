import { query } from 'express-validator';

export const residentReportValidation = [
  query('name').optional({ values: 'falsy' }).isString(),
  query('mobile').optional({ values: 'falsy' }).isString(),
  query('carNumber').optional({ values: 'falsy' }).isString(),
  query('page').optional().isInt({ min: 1 }),
  query('pageSize').optional().isInt({ min: 1, max: 100 }),
];

export const residentExportValidation = [
  query('name').optional({ values: 'falsy' }).isString(),
  query('mobile').optional({ values: 'falsy' }).isString(),
  query('carNumber').optional({ values: 'falsy' }).isString(),
];

export const collectionReportValidation = [
  query('month').isInt({ min: 1, max: 12 }),
  query('year').isInt({ min: 2020 }),
];

export const optionalDateRangeValidation = [
  query('fromDate').optional().isISO8601(),
  query('toDate').optional().isISO8601(),
];

export const requiredDateRangeValidation = [
  query('fromDate').isISO8601(),
  query('toDate').isISO8601(),
];