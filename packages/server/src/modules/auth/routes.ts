import { Request, Response, Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { body } from 'express-validator';
import { config } from '../../config';
import prisma from '../../config/database';
import logger from '../../config/logger';
import { validate } from '../../middleware/errorHandler';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { sendPasswordResetEmail, sendRegistrationEmail } from '../../config/email';

const router = Router();

async function ensureMembership(tx: any, userId: string, societyId: string, role: 'SUPER_ADMIN' | 'ADMIN' | 'OWNER' | 'TENANT') {
  await tx.userSocietyMembership.upsert({
    where: { userId_societyId: { userId, societyId } },
    update: { role },
    create: { userId, societyId, role },
  });
}

// ── REGISTER SOCIETY (Create new apartment) ─────────────
// Public endpoint: creates a Society + ADMIN user in one step.
router.post(
  '/register-society',
  [
    body('societyName').trim().notEmpty().withMessage('Apartment / Society name is required'),
    body('address').trim().notEmpty().withMessage('Address is required'),
    body('city').trim().notEmpty().withMessage('City is required'),
    body('state').trim().notEmpty().withMessage('State is required'),
    body('pincode').trim().isLength({ min: 6, max: 6 }).withMessage('Valid 6-digit pincode is required'),
    body('adminName').trim().notEmpty().withMessage('Admin name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
      .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
      .matches(/[a-z]/).withMessage('Password must contain a lowercase letter')
      .matches(/[0-9]/).withMessage('Password must contain a number'),
    body('phone')
      .optional({ values: 'falsy' })
      .isMobilePhone('en-IN')
      .withMessage('Phone must be a valid mobile number'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { societyName, address, city, state, pincode, adminName, email, password, phone } = req.body;

      logger.info('Register society attempt', { email, societyName });

      // Check if email already exists
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        logger.warn('Register society: email already exists', { email });
        return res.status(409).json({ error: 'Email already registered. Please login instead.' });
      }

      // Create society + admin user in a transaction
      const result = await prisma.$transaction(async (tx) => {
        const society = await tx.society.create({
          data: {
            name: societyName,
            address,
            city,
            state,
            pincode,
            totalBlocks: 0,
            totalFlats: 0,
          },
        });

        const passwordHash = await bcrypt.hash(password, 12);

        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            name: adminName,
            phone,
            role: 'ADMIN',
            societyId: society.id,
            activeSocietyId: society.id,
          },
          select: { id: true, email: true, name: true, role: true, societyId: true },
        });

        await ensureMembership(tx, user.id, society.id, 'ADMIN');

        return { society, user };
      });

      const tokens = generateTokens(result.user);

      logger.info('Society registered successfully', {
        societyId: result.society.id,
        societyName: result.society.name,
        userId: result.user.id,
        email: result.user.email,
      });

      // Send welcome email (non-blocking)
      sendRegistrationEmail(result.user.email, result.user.name, result.society.name).catch((emailError: any) => {
        logger.error('Failed to send registration email', { userId: result.user.id, error: emailError.message });
      });

      return res.status(201).json({
        user: { ...result.user, flat: null },
        society: {
          id: result.society.id,
          name: result.society.name,
        },
        ...tokens,
      });
    } catch (error: any) {
      logger.error('Register society failed', { error: error.message, stack: error.stack });
      return res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
  },
);

// ── REGISTER USER ───────────────────────────────────────
router.post(
  '/register',
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('phone')
      .optional({ values: 'falsy' })
      .isMobilePhone('en-IN')
      .withMessage('Phone must be a valid mobile number'),
    body('role').optional({ values: 'falsy' }).isIn(['OWNER', 'TENANT']).withMessage('Role must be OWNER or TENANT'),
    body('societyId').optional({ values: 'falsy' }).isUUID().withMessage('Invalid society ID'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { email, password, name, phone, role, societyId } = req.body;

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      const passwordHash = await bcrypt.hash(password, 12);

      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          name,
          phone,
          role: role || 'OWNER',
          societyId,
          activeSocietyId: societyId || null,
        },
        select: { id: true, email: true, name: true, role: true, societyId: true },
      });

      if (societyId) {
        await ensureMembership(prisma, user.id, societyId, (role || 'OWNER') as any);
      }

      const tokens = generateTokens(user);

      return res.status(201).json({ user, ...tokens });
    } catch (error) {
      return res.status(500).json({ error: 'Registration failed' });
    }
  },
);

// ── LOGIN ───────────────────────────────────────────────
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      logger.info('Login attempt', { email });

      const user = await prisma.user.findUnique({
        where: { email },
        include: {
          owners: { include: { flat: { include: { block: true } } } },
          tenants: { include: { flat: { include: { block: true } } } },
          societyMemberships: { include: { society: { select: { id: true, name: true } } } },
        },
      });

      if (!user || !user.isActive) {
        logger.warn('Login failed: user not found or inactive', { email });
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        logger.warn('Login failed: invalid password', { email });
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() },
      });

      const ownerSocietyIds = user.owners
        .map((owner) => owner.flat?.block?.societyId)
        .filter((id): id is string => !!id);
      const tenantSocietyIds = user.tenants
        .map((tenant) => tenant.flat?.block?.societyId)
        .filter((id): id is string => !!id);
      const knownSocietyIds = new Set<string>([
        ...(user.societyId ? [user.societyId] : []),
        ...ownerSocietyIds,
        ...tenantSocietyIds,
        ...user.societyMemberships.map((m) => m.societyId),
      ]);

      if (knownSocietyIds.size > 0) {
        await prisma.$transaction(async (tx) => {
          for (const sid of knownSocietyIds) {
            const existingMembership = await tx.userSocietyMembership.findUnique({
              where: { userId_societyId: { userId: user.id, societyId: sid } },
              select: { id: true },
            });
            if (!existingMembership) {
              await tx.userSocietyMembership.create({
                data: { userId: user.id, societyId: sid, role: user.role as any },
              });
            }
          }
        });
      }

      const activeSocietyId = user.activeSocietyId || user.societyId || [...knownSocietyIds][0] || null;

      if (activeSocietyId && activeSocietyId !== user.activeSocietyId) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            activeSocietyId,
            societyId: user.societyId || activeSocietyId,
          },
        });
      }

      const flatFromOwners = user.owners.find((owner) => owner.flat?.block?.societyId === activeSocietyId)?.flat;
      const flatFromTenants = user.tenants.find((tenant) => tenant.flat?.block?.societyId === activeSocietyId)?.flat;

      const societies = await prisma.userSocietyMembership.findMany({
        where: { userId: user.id },
        include: { society: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      });

      const activeMembership = activeSocietyId
        ? societies.find((membership) => membership.societyId === activeSocietyId)
        : null;
      const effectiveRole = activeMembership?.role || user.role;

      const tokens = generateTokens({
        id: user.id,
        email: user.email,
        role: effectiveRole,
        societyId: activeSocietyId,
      });

      return res.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: effectiveRole,
          societyId: activeSocietyId,
          flat: flatFromOwners || flatFromTenants || null,
          mustChangePassword: user.mustChangePassword,
          societies: societies.map((membership) => ({ id: membership.society.id, name: membership.society.name })),
        },
        ...tokens,
      });
    } catch (error: any) {
      logger.error('Login failed', { error: error.message, stack: error.stack });
      return res.status(500).json({ error: 'Login failed' });
    }
  },
);

// ── REFRESH TOKEN ───────────────────────────────────────
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      logger.warn('Refresh: no token provided');
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as {
      userId: string;
    };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, name: true, role: true, societyId: true, activeSocietyId: true, isActive: true },
    });

    if (!user || !user.isActive) {
      logger.warn('Refresh: user not found or inactive', { userId: decoded.userId });
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const effectiveSocietyId = user.activeSocietyId || user.societyId;
    const membership = effectiveSocietyId
      ? await prisma.userSocietyMembership.findUnique({
          where: { userId_societyId: { userId: user.id, societyId: effectiveSocietyId } },
          select: { role: true },
        })
      : null;

    const tokens = generateTokens({
      ...user,
      role: membership?.role || user.role,
      societyId: effectiveSocietyId,
    });
    logger.info('Token refreshed', { userId: user.id, email: user.email });
    return res.json(tokens);
  } catch (error: any) {
    logger.warn('Refresh: token verification failed', { error: error.message });
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// ── GET PROFILE ─────────────────────────────────────────
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        societyId: true,
        activeSocietyId: true,
        lastLogin: true,
        createdAt: true,
        owners: { include: { flat: { include: { block: true } } } },
        tenants: { include: { flat: { include: { block: true } } } },
        societyMemberships: { include: { society: { select: { id: true, name: true } } } },
      },
    });

    return res.json(user);
  } catch (error: any) {
    logger.error('Profile fetch failed', { userId: req.user!.id, error: error.message });
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.get('/my-societies', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const memberships = await prisma.userSocietyMembership.findMany({
      where: { userId: req.user!.id },
      include: { society: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return res.json({
      activeSocietyId: req.user!.societyId,
      societies: memberships.map((m) => ({ id: m.society.id, name: m.society.name, role: m.role })),
    });
  } catch (error: any) {
    logger.error('Fetch user societies failed', { userId: req.user!.id, error: error.message });
    return res.status(500).json({ error: 'Failed to fetch societies' });
  }
});

router.post(
  '/switch-society',
  authenticate,
  [body('societyId').isUUID().withMessage('Valid societyId is required')],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { societyId } = req.body;
      const membership = await prisma.userSocietyMembership.findUnique({
        where: { userId_societyId: { userId: req.user!.id, societyId } },
      });
      if (!membership) {
        return res.status(403).json({ error: 'You are not assigned to this society' });
      }

      const updatedUser = await prisma.user.update({
        where: { id: req.user!.id },
        data: {
          activeSocietyId: societyId,
          societyId,
        },
        select: { id: true, email: true, name: true, role: true, societyId: true, mustChangePassword: true },
      });

      const effectiveRole = membership.role;
      const tokens = generateTokens({ ...updatedUser, role: effectiveRole });

      return res.json({
        message: 'Active society switched',
        user: {
          ...updatedUser,
          role: effectiveRole,
        },
        ...tokens,
      });
    } catch (error: any) {
      logger.error('Switch society failed', { userId: req.user!.id, error: error.message });
      return res.status(500).json({ error: 'Failed to switch society' });
    }
  },
);

// ── CHANGE PASSWORD (authenticated) ─────────────────────
router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
      .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
      .matches(/[a-z]/).withMessage('Password must contain a lowercase letter')
      .matches(/[0-9]/).withMessage('Password must contain a number'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { currentPassword, newPassword } = req.body;

      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
      if (!user) return res.status(404).json({ error: 'User not found' });

      const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isValid) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      await prisma.user.update({
        where: { id: req.user!.id },
        data: { passwordHash, mustChangePassword: false },
      });

      logger.info('Password changed', { userId: req.user!.id });
      return res.json({ message: 'Password changed successfully' });
    } catch (error: any) {
      logger.error('Change password failed', { userId: req.user!.id, error: error.message });
      return res.status(500).json({ error: 'Failed to change password' });
    }
  },
);

// ── FORGOT PASSWORD (public) ────────────────────────────
router.post(
  '/forgot-password',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { email } = req.body;

      const user = await prisma.user.findUnique({ where: { email } });

      // Always return success to prevent email enumeration
      if (!user || !user.isActive) {
        logger.info('Forgot password: email not found (silent)', { email });
        return res.json({ message: 'If an account with that email exists, a reset token has been generated.' });
      }

      // Generate a secure reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: hashedToken,
          passwordResetExpiry: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        },
      });

      // Send reset email
      try {
        await sendPasswordResetEmail(user.email, resetToken, user.name);
        logger.info('Password reset email sent', { userId: user.id, email });
      } catch (emailError: any) {
        logger.error('Failed to send reset email', { userId: user.id, error: emailError.message });
        // Don't expose email delivery failure to user
      }

      return res.json({
        message: 'If an account with that email exists, a password reset link has been sent to your email.',
      });
    } catch (error: any) {
      logger.error('Forgot password failed', { error: error.message });
      return res.status(500).json({ error: 'Failed to process request' });
    }
  },
);

// ── RESET PASSWORD (public, using token) ────────────────
router.post(
  '/reset-password',
  [
    body('token').notEmpty().withMessage('Reset token is required'),
    body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
      .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
      .matches(/[a-z]/).withMessage('Password must contain a lowercase letter')
      .matches(/[0-9]/).withMessage('Password must contain a number'),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { token, newPassword } = req.body;

      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

      const user = await prisma.user.findFirst({
        where: {
          passwordResetToken: hashedToken,
          passwordResetExpiry: { gte: new Date() },
          isActive: true,
        },
      });

      if (!user) {
        return res.status(400).json({ error: 'Invalid or expired reset token' });
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordResetToken: null,
          passwordResetExpiry: null,
          mustChangePassword: false,
        },
      });

      logger.info('Password reset successful', { userId: user.id });
      return res.json({ message: 'Password reset successful. You can now login with your new password.' });
    } catch (error: any) {
      logger.error('Reset password failed', { error: error.message });
      return res.status(500).json({ error: 'Failed to reset password' });
    }
  },
);

// ── HELPER ──────────────────────────────────────────────
function generateTokens(user: { id: string; email: string; role: string; societyId?: string | null }) {
  const accessToken = jwt.sign(
    { userId: user.id, email: user.email, role: user.role, societyId: user.societyId },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn },
  );

  const refreshToken = jwt.sign(
    { userId: user.id },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn },
  );

  return { accessToken, refreshToken };
}

export default router;
