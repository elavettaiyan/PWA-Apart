import { Router, Response } from 'express';
import { body, param } from 'express-validator';
import bcrypt from 'bcryptjs';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest, SOCIETY_ADMINS } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';

const router = Router();
router.use(authenticate);
router.use(authorize('SUPER_ADMIN', ...SOCIETY_ADMINS));

// ── GET ALL STAFF IN SOCIETY ────────────────────────────
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const societyId = req.user!.societyId;
    if (!societyId) return res.status(400).json({ error: 'Society ID required' });

    const memberships = await prisma.userSocietyMembership.findMany({
      where: { societyId, role: 'SERVICE_STAFF' },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, specialization: true, isActive: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(memberships.map((m) => ({ ...m.user, membershipId: m.id })));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch staff' });
  }
});

// ── CREATE STAFF MEMBER ─────────────────────────────────
router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('phone').optional({ values: 'falsy' }).isMobilePhone('en-IN'),
    body('specialization').optional().isString(),
    body('password').optional({ values: 'falsy' }).isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.societyId;
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const { name, email, phone, specialization, password } = req.body;

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        const membership = await prisma.userSocietyMembership.findUnique({
          where: { userId_societyId: { userId: existing.id, societyId } },
        });

        if (membership?.role === 'SERVICE_STAFF') {
          return res.status(409).json({ error: 'This service staff account is already linked to your society' });
        }

        if (membership) {
          return res.status(409).json({ error: 'This user is already assigned to your society with a different role' });
        }

        if (existing.specialization && specialization && existing.specialization !== specialization) {
          return res.status(409).json({
            error: `This account is already registered as ${existing.specialization}. Use the same specialization to link it to another society.`,
          });
        }

        const linkedUser = await prisma.$transaction(async (tx) => {
          const user = await tx.user.update({
            where: { id: existing.id },
            data: {
              name,
              phone: phone || existing.phone,
              specialization: specialization || existing.specialization,
            },
            select: { id: true, name: true, email: true, phone: true, specialization: true, isActive: true, createdAt: true },
          });

          await tx.userSocietyMembership.create({
            data: { userId: existing.id, societyId, role: 'SERVICE_STAFF' },
          });

          return user;
        });

        return res.status(200).json({
          message: 'Existing account linked to this society. The user keeps their current password.',
          user: linkedUser,
        });
      }

      if (!password || password.length < 8) {
        return res.status(400).json({ error: 'Password is required for new staff accounts and must be at least 8 characters' });
      }

      const passwordHash = await bcrypt.hash(password, 12);

      const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            name,
            phone: phone || null,
            role: 'SERVICE_STAFF',
            specialization: specialization || null,
            societyId,
            activeSocietyId: societyId,
          },
          select: { id: true, name: true, email: true, phone: true, specialization: true, isActive: true, createdAt: true },
        });

        await tx.userSocietyMembership.create({
          data: { userId: user.id, societyId, role: 'SERVICE_STAFF' },
        });

        return user;
      });

      return res.status(201).json({
        message: 'Staff member created',
        user: result,
      });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create staff member' });
    }
  },
);

// ── UPDATE STAFF MEMBER ─────────────────────────────────
router.patch(
  '/:id',
  [
    param('id').isUUID(),
    body('name').optional().trim().notEmpty(),
    body('phone').optional({ values: 'falsy' }).isMobilePhone('en-IN'),
    body('specialization').optional().isString(),
    body('isActive').optional().isBoolean(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.societyId;
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      // SECURITY: Verify staff belongs to admin's society
      const membership = await prisma.userSocietyMembership.findFirst({
        where: { userId: req.params.id, societyId, role: 'SERVICE_STAFF' },
      });
      if (!membership) return res.status(404).json({ error: 'Staff member not found in your society' });

      const data: any = {};
      if (req.body.name !== undefined) data.name = req.body.name;
      if (req.body.phone !== undefined) data.phone = req.body.phone;
      if (req.body.specialization !== undefined) data.specialization = req.body.specialization;
      if (req.body.isActive !== undefined) data.isActive = req.body.isActive;

      const user = await prisma.user.update({
        where: { id: req.params.id },
        data,
        select: { id: true, name: true, email: true, phone: true, specialization: true, isActive: true, createdAt: true },
      });

      return res.json(user);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update staff member' });
    }
  },
);

export default router;
