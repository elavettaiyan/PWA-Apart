import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { validationResult } from 'express-validator';
import logger from '../config/logger';
import { UploadValidationError } from './upload';
import { AppError, sendError } from '../lib/http';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof UploadValidationError) {
    logger.warn('Upload validation failed', {
      error: err.message,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
    });

    sendError(res, err.statusCode, err.message);
    return;
  }

  if (err instanceof multer.MulterError) {
    logger.warn('Upload failed', {
      error: err.message,
      code: err.code,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
    });

    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Uploaded file is too large.'
      : err.message;

    sendError(res, 400, message);
    return;
  }

  if (err instanceof AppError) {
    const level = err.statusCode >= 500 ? 'error' : 'warn';
    logger[level]('Application error', {
      error: err.message,
      code: err.code,
      statusCode: err.statusCode,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
    });

    sendError(
      res,
      err.statusCode,
      err.expose ? err.message : 'Internal server error',
      { code: err.code, errors: err.details },
    );
    return;
  }

  // Sanitize sensitive fields before logging
  const sanitizedBody = req.method !== 'GET' && req.body
    ? (() => {
        const b = { ...req.body };
        if (b.password) b.password = '[REDACTED]';
        if (b.passwordHash) b.passwordHash = '[REDACTED]';
        if (b.saltKey) b.saltKey = '[REDACTED]';
        if (b.refreshToken) b.refreshToken = '[REDACTED]';
        return JSON.stringify(b).substring(0, 500);
      })()
    : undefined;

  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    body: sanitizedBody,
    ip: req.ip,
  });

  const body = {
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  };

  res.status(500).json(body);
};

export const notFound = (req: Request, res: Response): void => {
  logger.warn(`Route not found: ${req.method} ${req.originalUrl}`);
  sendError(res, 404, 'Route not found');
};

export const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorList = errors.array();
    const firstError = errorList[0];

    logger.warn('Validation failed', {
      url: req.originalUrl,
      errors: errorList.map(e => ({ field: (e as any).path, msg: e.msg })),
    });
    sendError(res, 400, firstError?.msg || 'Validation failed', { errors: errorList });
    return;
  }
  next();
};
