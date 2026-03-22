import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import prisma from '../config/database';
import logger from '../config/logger';

// ─── ROLE GROUPS ────────────────────────────────────────
export const SOCIETY_ADMINS = ['ADMIN', 'SECRETARY'] as const;
export const SOCIETY_MANAGERS = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY'] as const;
export const FINANCIAL_ROLES = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER'] as const;
export const RESIDENT_ROLES = ['OWNER', 'TENANT'] as const;
export const ALL_SOCIETY_ROLES = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER', 'OWNER', 'TENANT', 'SERVICE_STAFF'] as const;

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    societyId: string | null;
    activeSocietyId?: string | null;
  };
}

type AuthUserLookup = {
  id: string;
  email: string;
  role: string;
  societyId: string | null;
  activeSocietyId: string | null;
  isActive: boolean;
};

const AUTH_USER_CACHE_TTL_MS = Number(process.env.AUTH_USER_CACHE_TTL_MS || 60_000);
const authUserCache = new Map<string, { value: AuthUserLookup | null; expiresAt: number }>();
const authUserInFlight = new Map<string, Promise<AuthUserLookup | null>>();

/** Evict a specific user from the auth cache so the next request re-fetches from DB */
export function invalidateAuthCache(userId: string) {
  authUserCache.delete(userId);
}

async function getAuthUser(userId: string): Promise<{ user: AuthUserLookup | null; cacheHit: boolean; inFlightHit: boolean }> {
  const now = Date.now();
  const cached = authUserCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return { user: cached.value, cacheHit: true, inFlightHit: false };
  }

  const inFlight = authUserInFlight.get(userId);
  if (inFlight) {
    return { user: await inFlight, cacheHit: false, inFlightHit: true };
  }

  const lookupPromise = prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, societyId: true, activeSocietyId: true, isActive: true },
  });

  authUserInFlight.set(userId, lookupPromise);

  try {
    const user = await lookupPromise;
    authUserCache.set(userId, {
      value: user,
      expiresAt: Date.now() + AUTH_USER_CACHE_TTL_MS,
    });
    return { user, cacheHit: false, inFlightHit: false };
  } finally {
    authUserInFlight.delete(userId);
  }
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
    const { user, cacheHit, inFlightHit } = await getAuthUser(decoded.userId);
    const userLookupMs = Date.now() - userLookupStart;

    if (!user || !user.isActive) {
      logger.warn('Auth: User not found or inactive', { userId: decoded.userId, url: req.originalUrl });
      res.status(401).json({ error: 'User not found or inactive' });
      return;
    }

    const effectiveSocietyId = user.activeSocietyId || user.societyId || decoded.societyId || null;
    // Always use DB role so role changes take effect immediately (within cache TTL)
    const effectiveRole = user.role;

    req.user = {
      id: user.id,
      email: user.email,
      role: effectiveRole,
      societyId: effectiveSocietyId,
      activeSocietyId: user.activeSocietyId,
    };

    // Send current role in response header so client can detect role changes
    res.setHeader('X-User-Role', effectiveRole);

    logger.info('auth.performance', {
      userId: user.id,
      role: effectiveRole,
      societyId: effectiveSocietyId,
      url: req.originalUrl,
      cacheHit,
      inFlightHit,
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
