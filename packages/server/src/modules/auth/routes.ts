import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body } from 'express-validator';
import { config } from '../../config';
import prisma from '../../config/database';
import { validate } from '../../middleware/errorHandler';
import { authenticate, AuthRequest } from '../../middleware/auth';

const router = Router();

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
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('phone').optional().isMobilePhone('en-IN'),
  ],
  validate,
  async (req: AuthRequest, res) => {
    try {
      const { societyName, address, city, state, pincode, adminName, email, password, phone } = req.body;

      // Check if email already exists
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
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
          },
          select: { id: true, email: true, name: true, role: true, societyId: true },
        });

        return { society, user };
      });

      const tokens = generateTokens(result.user);

      return res.status(201).json({
        user: { ...result.user, flat: null },
        society: {
          id: result.society.id,
          name: result.society.name,
        },
        ...tokens,
      });
    } catch (error) {
      return res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
  },
);

// ── REGISTER USER ───────────────────────────────────────
router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('name').trim().notEmpty(),
    body('phone').optional().isMobilePhone('en-IN'),
    body('role').optional().isIn(['ADMIN', 'OWNER', 'TENANT']),
    body('societyId').optional().isUUID(),
  ],
  validate,
  async (req: AuthRequest, res) => {
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
        },
        select: { id: true, email: true, name: true, role: true, societyId: true },
      });

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
  async (req, res) => {
    try {
      const { email, password } = req.body;

      const user = await prisma.user.findUnique({
        where: { email },
        include: { owner: { include: { flat: true } }, tenant: { include: { flat: true } } },
      });

      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() },
      });

      const tokens = generateTokens({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        societyId: user.societyId,
      });

      return res.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          societyId: user.societyId,
          flat: user.owner?.flat || user.tenant?.flat || null,
        },
        ...tokens,
      });
    } catch (error) {
      return res.status(500).json({ error: 'Login failed' });
    }
  },
);

// ── REFRESH TOKEN ───────────────────────────────────────
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as {
      userId: string;
    };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, name: true, role: true, societyId: true, isActive: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const tokens = generateTokens(user);
    return res.json(tokens);
  } catch (error) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// ── GET PROFILE ─────────────────────────────────────────
router.get('/me', authenticate, async (req: AuthRequest, res) => {
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
        lastLogin: true,
        createdAt: true,
        owner: { include: { flat: { include: { block: true } } } },
        tenant: { include: { flat: { include: { block: true } } } },
      },
    });

    return res.json(user);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

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
