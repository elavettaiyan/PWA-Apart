import { NextFunction, Request, RequestHandler, Response } from 'express';

export type ErrorResponseBody = {
  error: string;
  message?: string;
  code?: string;
  errors?: unknown;
};

export class AppError extends Error {
  readonly statusCode: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(statusCode: number, message: string, options: { code?: string; details?: unknown; expose?: boolean } = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = options.code;
    this.details = options.details;
    this.expose = options.expose ?? statusCode < 500;
  }
}

export const asyncHandler = <TRequest extends Request = Request>(
  handler: (req: TRequest, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler => {
  return (req, res, next) => {
    Promise.resolve(handler(req as TRequest, res, next)).catch(next);
  };
};

export const sendOk = <T>(res: Response, data: T): void => {
  res.json(data);
};

export const sendCreated = <T>(res: Response, data: T): void => {
  res.status(201).json(data);
};

export const sendNoContent = (res: Response): void => {
  res.status(204).send();
};

export const sendError = (res: Response, statusCode: number, message: string, options: { code?: string; errors?: unknown } = {}): void => {
  const body: ErrorResponseBody = { error: message };

  if (options.code) {
    body.code = options.code;
  }

  if (options.errors !== undefined) {
    body.errors = options.errors;
  }

  res.status(statusCode).json(body);
};

export const badRequest = (message: string, details?: unknown): AppError => new AppError(400, message, { details });
export const unauthorized = (message = 'Authentication required'): AppError => new AppError(401, message);
export const forbidden = (message = 'Insufficient permissions'): AppError => new AppError(403, message);
export const notFoundError = (message = 'Not found'): AppError => new AppError(404, message);
export const conflict = (message: string, details?: unknown): AppError => new AppError(409, message, { details });