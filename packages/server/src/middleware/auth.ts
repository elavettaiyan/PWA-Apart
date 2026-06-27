import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { config } from '../config';
import prisma from '../config/database';
import logger from '../config/logger';
import { buildPremiumLifecycleMessage, ensurePremiumLifecycleForSociety, shouldBlockPremiumRole } from '../modules/premium/lifecycle';
import { sendError } from '../lib/http';

// ─── ROLE GROUPS ────────────────────────────────────────
export const SOCIETY_ADMINS = ['ADMIN', 'SECRETARY'] as const;
export const SOCIETY_MANAGERS = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY'] as const;
export const FINANCIAL_ROLES = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER'] as const;
export const RESIDENT_ROLES = ['OWNER', 'TENANT'] as const;
export const ALL_SOCIETY_ROLES = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER', 'OWNER', 'TENANT', 'SERVICE_STAFF'] as const;

type AuthFailureStatus = 401 | 403;

const AUTH_ERROR_MESSAGES = {
  accessTokenRequired: 'Access token required',
  authenticationRequired: 'Authentication required',
  inactiveUser: 'User not found or inactive',
  invalidToken: 'Invalid or expired token',
  insufficientPermissions: 'Insufficient permissions',
} as const;

const sendAuthError = (res: Response, statusCode: AuthFailureStatus, message: string, code?: string): void => {
  sendError(res, statusCode, message, { code });
};

export const hasAnyRole = (role: string, allowedRoles: readonly string[]): boolean => {
  return allowedRoles.includes(role);
};

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    societyId: string | null;
    activeSocietyId?: string | null;
    premiumLifecycle?: {
      stage: string;
      message: string | null;
      adminCanRecover: boolean;
    };
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
      sendAuthError(res, 401, AUTH_ERROR_MESSAGES.accessTokenRequired);
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
      sendAuthError(res, 401, AUTH_ERROR_MESSAGES.inactiveUser);
      return;
    }

    const effectiveSocietyId = user.activeSocietyId || user.societyId || decoded.societyId || null;
    const membership = effectiveSocietyId
      ? await prisma.userSocietyMembership.findUnique({
          where: { userId_societyId: { userId: user.id, societyId: effectiveSocietyId } },
          select: { role: true },
        })
      : null;
    const effectiveRole = user.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : (membership?.role || decoded.role || user.role);

    req.user = {
      id: user.id,
      email: user.email,
      role: effectiveRole,
      societyId: effectiveSocietyId,
      activeSocietyId: user.activeSocietyId,
    };

    if (effectiveSocietyId && effectiveRole !== 'SUPER_ADMIN') {
      const lifecycle = await ensurePremiumLifecycleForSociety(effectiveSocietyId);
      const lifecycleMessage = buildPremiumLifecycleMessage(lifecycle);

      if (lifecycle.stage === 'ARCHIVED') {
        sendAuthError(
          res,
          403,
          lifecycleMessage || 'This society account has been archived due to long overdue Premium renewal.',
          'SOCIETY_ARCHIVED',
        );
        return;
      }

      if (shouldBlockPremiumRole(effectiveRole, lifecycle)) {
        sendAuthError(
          res,
          403,
          lifecycleMessage || 'Your role access is temporarily blocked until Premium renewal payment is completed by Admin.',
          'PREMIUM_ROLE_LOGIN_BLOCKED',
        );
        return;
      }

      req.user.premiumLifecycle = {
        stage: lifecycle.stage,
        message: lifecycleMessage,
        adminCanRecover: lifecycle.adminCanRecover,
      };
    }

    // Send current role in response header so client can detect role changes
    res.setHeader('X-User-Role', effectiveRole);

    logger.info('auth.performance', {
      userId: user.id,
      role: effectiveRole,
      societyId: effectiveSocietyId,
      membershipRole: membership?.role || null,
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
    sendAuthError(res, 401, AUTH_ERROR_MESSAGES.invalidToken);
  }
};

export const requireAnyRole = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      logger.warn('Authorize: No user on request', { url: req.originalUrl });
      sendAuthError(res, 401, AUTH_ERROR_MESSAGES.authenticationRequired);
      return;
    }

    if (!hasAnyRole(req.user.role, roles)) {
      logger.warn('Authorize: Insufficient permissions', {
        userId: req.user.id,
        role: req.user.role,
        required: roles,
        url: req.originalUrl,
      });
      sendAuthError(res, 403, AUTH_ERROR_MESSAGES.insufficientPermissions);
      return;
    }

    next();
  };
};

export const authorize = requireAnyRole;
