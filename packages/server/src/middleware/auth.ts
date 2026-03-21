import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import prisma from '../config/database';
import logger from '../config/logger';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    societyId: string | null;
    activeSocietyId?: string | null;
  };
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const startMs = Date.now();
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('Auth: Missing or invalid token header', { url: req.originalUrl, ip: req.ip });
      res.status(401).json({ error: 'Access token required' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwt.secret) as {
      userId: string;
      email: string;
      role: string;
      societyId: string | null;
    };

    const userLookupStart = Date.now();
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, role: true, societyId: true, activeSocietyId: true, isActive: true },
    });
    const userLookupMs = Date.now() - userLookupStart;

    if (!user || !user.isActive) {
      logger.warn('Auth: User not found or inactive', { userId: decoded.userId, url: req.originalUrl });
      res.status(401).json({ error: 'User not found or inactive' });
      return;
    }

    const effectiveSocietyId = user.activeSocietyId || user.societyId || decoded.societyId || null;
    // Use token role as effective role for current token context.
    // This avoids an extra DB lookup on every request and reduces latency.
    const effectiveRole = decoded.role || user.role;

    req.user = {
      id: user.id,
      email: user.email,
      role: effectiveRole,
      societyId: effectiveSocietyId,
      activeSocietyId: user.activeSocietyId,
    };

    logger.info('auth.performance', {
      userId: user.id,
      role: effectiveRole,
      societyId: effectiveSocietyId,
      url: req.originalUrl,
      timings: {
        userLookupMs,
        totalMs: Date.now() - startMs,
      },
    });

    next();
  } catch (error: any) {
    logger.warn('Auth: Token verification failed', { error: error.message, url: req.originalUrl });
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      logger.warn('Authorize: No user on request', { url: req.originalUrl });
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      logger.warn('Authorize: Insufficient permissions', {
        userId: req.user.id,
        role: req.user.role,
        required: roles,
        url: req.originalUrl,
      });
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
};
