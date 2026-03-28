import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { validationResult } from 'express-validator';
import logger from '../config/logger';
import { UploadValidationError } from './upload';

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

    res.status(err.statusCode).json({ error: err.message });
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

    res.status(400).json({ error: message });
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

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
};

export const notFound = (req: Request, res: Response): void => {
  logger.warn(`Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: 'Route not found' });
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
    res.status(400).json({
      error: firstError?.msg || 'Validation failed',
      errors: errorList,
    });
    return;
  }
  next();
};
