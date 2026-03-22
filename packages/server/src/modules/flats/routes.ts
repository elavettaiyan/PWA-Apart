import { Response, Router } from 'express';
import { body, param, query } from 'express-validator';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest, SOCIETY_MANAGERS } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import logger from '../../config/logger';

const router = Router();

// All routes require authentication
router.use(authenticate);

function buildMyFlatInclude(year?: number): Prisma.FlatInclude {
  return {
    block: { include: { society: { select: { id: true, name: true } } } },
    owner: true,
    tenant: true,
    bills: {
      where: year ? { year } : undefined,
      include: {
        payments: {
          where: { status: 'SUCCESS' },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    },
  };
}

// ── GET MY FLAT (Owner/Tenant) ───────────────────────────
router.get('/my-flat', [query('societyId').optional().isUUID(), query('year').optional().isInt({ min: 2020 })], validate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const selectedSocietyId = (req.query.societyId as string) || req.user!.societyId || undefined;
    const selectedYear = req.query.year ? Number(req.query.year) : undefined;

    // Check if user is an owner
    const owner = await prisma.owner.findFirst({
      where: {
        userId,
        ...(selectedSocietyId ? { flat: { block: { societyId: selectedSocietyId } } } : {}),
      },
      include: {
        flat: {
          include: buildMyFlatInclude(selectedYear),
        },
      },
    });

    if (owner) return res.json(owner.flat);

    // Check if user is a tenant
    const tenant = await prisma.tenant.findFirst({
      where: {
        userId,
        ...(selectedSocietyId ? { flat: { block: { societyId: selectedSocietyId } } } : {}),
      },
      include: {
        flat: {
          include: buildMyFlatInclude(selectedYear),
        },
      },
    });

    if (tenant) return res.json(tenant.flat);

    // Fallback for users whose active society does not currently have a flat link.
    const fallbackOwner = await prisma.owner.findFirst({
      where: { userId },
      include: {
        flat: {
          include: buildMyFlatInclude(selectedYear),
        },
      },
    });
    if (fallbackOwner) return res.json(fallbackOwner.flat);

    const fallbackTenant = await prisma.tenant.findFirst({
      where: { userId },
      include: {
        flat: {
          include: buildMyFlatInclude(selectedYear),
        },
      },
    });
    if (fallbackTenant) return res.json(fallbackTenant.flat);

    return res.status(404).json({ error: 'No flat linked to your account' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch your flat' });
  }
});

// ── GET ALL SOCIETIES ───────────────────────────────────
router.get('/societies', async (req: AuthRequest, res: Response) => {
  try {
    const where: any = {};
    // Non-SUPER_ADMIN users can only see their own society
    if (req.user!.role !== 'SUPER_ADMIN' && req.user!.societyId) {
      where.id = req.user!.societyId;
    }

    const societies = await prisma.society.findMany({
      where,
      include: { _count: { select: { blocks: true } } },
      orderBy: { name: 'asc' },
    });
    return res.json(societies);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch societies' });
  }
});

// ── CREATE SOCIETY ──────────────────────────────────────
router.post(
  '/societies',
  authorize('SUPER_ADMIN'),
  [
    body('name').trim().notEmpty(),
    body('address').trim().notEmpty(),
    body('city').trim().notEmpty(),
    body('state').trim().notEmpty(),
    body('pincode').trim().isLength({ min: 6, max: 6 }),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const society = await prisma.society.create({
        data: {
          name: req.body.name,
          address: req.body.address,
          city: req.body.city,
          state: req.body.state,
          pincode: req.body.pincode,
        },
      });
      return res.status(201).json(society);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create society' });
    }
  },
);

// ── GET ALL FLATS ───────────────────────────────────────
router.get(
  '/flats',
  [query('blockId').optional().isUUID(), query('societyId').optional().isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { blockId, societyId } = req.query;

      const where: any = {};
      if (blockId) where.blockId = blockId;
      if (societyId) where.block = { societyId };

      // For non-admin users, restrict to their society
      if (req.user!.role !== 'SUPER_ADMIN' && req.user!.societyId) {
        where.block = { ...where.block, societyId: req.user!.societyId };
      }

      const flats = await prisma.flat.findMany({
        where,
        include: {
          block: { include: { society: { select: { id: true, name: true } } } },
          owner: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              userId: true,
              aadharNo: true,
              panNo: true,
              altPhone: true,
              moveInDate: true,
            },
          },
          tenant: { select: { id: true, name: true, phone: true, email: true, isActive: true } },
        },
        orderBy: [{ block: { name: 'asc' } }, { floor: 'asc' }, { flatNumber: 'asc' }],
      });

      return res.json(flats);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch flats' });
    }
  },
);

// ── GET SINGLE FLAT ─────────────────────────────────────
router.get('/flats/:id', [param('id').isUUID()], validate, async (req: AuthRequest, res: Response) => {
  try {
    const flat = await prisma.flat.findUnique({
      where: { id: req.params.id },
      include: {
        block: { include: { society: true } },
        owner: true,
        tenant: true,
        bills: { orderBy: { createdAt: 'desc' }, take: 12 },
        complaints: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });

    if (!flat) {
      return res.status(404).json({ error: 'Flat not found' });
    }

    // SECURITY: Verify flat belongs to user's society
    if (req.user!.role !== 'SUPER_ADMIN' && flat.block.societyId !== req.user!.societyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.json(flat);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch flat' });
  }
});

// ── CREATE FLAT ─────────────────────────────────────────
router.post(
  '/flats',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [
    body('flatNumber').trim().notEmpty(),
    body('floor').isInt({ min: 0 }),
    body('type').isIn(['ONE_BHK', 'TWO_BHK', 'THREE_BHK', 'FOUR_BHK', 'STUDIO', 'PENTHOUSE', 'SHOP', 'OTHER']),
    body('areaSqFt').optional().isFloat({ min: 0 }),
    body('blockId').isUUID(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // SECURITY: Verify block belongs to admin's society
      const block = await prisma.block.findUnique({ where: { id: req.body.blockId } });
      if (!block) return res.status(404).json({ error: 'Block not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && block.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // SECURITY: Whitelist allowed fields
      const flat = await prisma.flat.create({
        data: {
          flatNumber: req.body.flatNumber,
          floor: req.body.floor,
          type: req.body.type,
          areaSqFt: req.body.areaSqFt || null,
          blockId: req.body.blockId,
        },
        include: { block: true },
      });
      return res.status(201).json(flat);
    } catch (error: any) {
      if (error.code === 'P2002') {
        return res.status(409).json({ error: 'Flat number already exists in this block' });
      }
      return res.status(500).json({ error: 'Failed to create flat' });
    }
  },
);

// ── UPDATE FLAT ─────────────────────────────────────────
router.put(
  '/flats/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // SECURITY: Verify flat belongs to admin's society
      const existing = await prisma.flat.findUnique({
        where: { id: req.params.id },
        include: { block: true },
      });
      if (!existing) return res.status(404).json({ error: 'Flat not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && existing.block.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // SECURITY: Whitelist allowed fields
      const flat = await prisma.flat.update({
        where: { id: req.params.id },
        data: {
          flatNumber: req.body.flatNumber,
          floor: req.body.floor,
          type: req.body.type,
          areaSqFt: req.body.areaSqFt,
          isOccupied: req.body.isOccupied,
        },
        include: { block: true, owner: true, tenant: true },
      });
      return res.json(flat);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update flat' });
    }
  },
);

// ── DELETE FLAT ─────────────────────────────────────────
router.delete(
  '/flats/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [param('id').isUUID(), body('confirmation').trim().notEmpty()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // SECURITY: Verify flat belongs to admin's society
      const existing = await prisma.flat.findUnique({
        where: { id: req.params.id },
        include: {
          block: true,
          owner: { select: { id: true } },
          tenant: { select: { id: true } },
          _count: { select: { bills: true, complaints: true } },
        },
      });
      if (!existing) return res.status(404).json({ error: 'Flat not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && existing.block.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (req.body.confirmation !== existing.flatNumber) {
        return res.status(400).json({ error: 'Confirmation does not match the selected flat number' });
      }

      if (existing.owner || existing.tenant || existing.isOccupied || existing._count.bills > 0 || existing._count.complaints > 0) {
        return res.status(409).json({
          error: 'Only vacant flats without linked owners, tenants, bills, or complaints can be deleted',
        });
      }

      await prisma.flat.delete({ where: { id: req.params.id } });
      return res.json({ message: 'Flat deleted successfully' });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to delete flat' });
    }
  },
);

// ── BLOCKS CRUD ─────────────────────────────────────────
router.get('/blocks', async (req: AuthRequest, res: Response) => {
  try {
    const where: any = {};
    // Always scope to user's society (SUPER_ADMIN can optionally filter by societyId)
    if (req.user!.role === 'SUPER_ADMIN' && req.query.societyId) {
      where.societyId = req.query.societyId;
    } else if (req.user!.societyId) {
      where.societyId = req.user!.societyId;
    }

    const blocks = await prisma.block.findMany({
      where,
      include: { _count: { select: { flats: true } }, society: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
    return res.json(blocks);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch blocks' });
  }
});

router.post(
  '/blocks',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [body('name').trim().notEmpty(), body('floors').isInt({ min: 1 }), body('societyId').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // SECURITY: Verify societyId matches admin's society
      const societyId = req.body.societyId;
      if (req.user!.role !== 'SUPER_ADMIN' && societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const block = await prisma.block.create({
        data: {
          name: req.body.name,
          floors: req.body.floors,
          societyId,
        },
      });
      return res.status(201).json(block);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create block' });
    }
  },
);

// ── OWNER CRUD ──────────────────────────────────────────
router.post(
  '/owners',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [
    body('name').trim().notEmpty(),
    body('phone').notEmpty(),
    body('email').optional({ values: 'falsy' }).isEmail(),
    body('flatId').isUUID(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // SECURITY: Verify flat belongs to admin's society
      const flat = await prisma.flat.findUnique({
        where: { id: req.body.flatId },
        include: { block: true },
      });
      if (!flat) return res.status(404).json({ error: 'Flat not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && flat.block.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // SECURITY: Whitelist allowed fields
      // Use a transaction to create owner + user account atomically
      const result = await prisma.$transaction(async (tx) => {
        const normalizedEmail = req.body.email ? String(req.body.email).trim().toLowerCase() : '';

        if (normalizedEmail) {
          const existingOwner = await tx.owner.findFirst({
            where: {
              email: normalizedEmail,
              flat: { block: { societyId: flat.block.societyId } },
            },
            select: { id: true },
          });
          if (existingOwner) {
            throw new Error('OWNER_EMAIL_ALREADY_EXISTS');
          }
        }

        // Auto-create a user account for the owner (password = phone number)
        let userId: string | null = null;
        if (req.body.email && req.body.phone) {
          const normalizedOwnerEmail = String(req.body.email).trim().toLowerCase();

          const existingUser = await tx.user.findUnique({
            where: { email: normalizedOwnerEmail },
            select: { id: true, role: true },
          });

          if (existingUser) {
            const sameSocietyMembership = await tx.userSocietyMembership.findUnique({
              where: { userId_societyId: { userId: existingUser.id, societyId: flat.block.societyId } },
              select: { id: true },
            });
            if (sameSocietyMembership) {
              throw new Error('USER_EMAIL_ALREADY_EXISTS_IN_SOCIETY');
            }

            await tx.userSocietyMembership.create({
              data: {
                userId: existingUser.id,
                societyId: flat.block.societyId,
                role: 'OWNER',
              },
            });
            userId = existingUser.id;
          } else {
            const passwordHash = await bcrypt.hash(req.body.phone, 12);
            const newUser = await tx.user.create({
              data: {
                email: normalizedOwnerEmail,
                passwordHash,
                name: req.body.name,
                phone: req.body.phone,
                role: 'OWNER',
                societyId: flat.block.societyId,
                activeSocietyId: flat.block.societyId,
                mustChangePassword: true,
              },
            });
            await tx.userSocietyMembership.create({
              data: {
                userId: newUser.id,
                societyId: flat.block.societyId,
                role: 'OWNER',
              },
            });
            userId = newUser.id;
          }
        }

        const owner = await tx.owner.create({
          data: {
            name: req.body.name,
            phone: req.body.phone,
            email: req.body.email ? String(req.body.email).trim().toLowerCase() : null,
            altPhone: req.body.altPhone || null,
            aadharNo: req.body.aadharNo || null,
            panNo: req.body.panNo || null,
            flatId: req.body.flatId,
            moveInDate: req.body.moveInDate ? new Date(req.body.moveInDate) : null,
            userId,
          },
        });

        // Mark flat as occupied
        await tx.flat.update({
          where: { id: req.body.flatId },
          data: { isOccupied: true },
        });

        return { owner, userCreated: !!userId && !req.body.email ? false : !!userId };
      });

      logger.info('Owner created', {
        ownerId: result.owner.id,
        flatId: req.body.flatId,
        userCreated: result.userCreated,
      });

      return res.status(201).json({
        ...result.owner,
        userCreated: result.userCreated,
        loginInfo: result.userCreated ? {
          email: req.body.email,
          defaultPassword: 'Phone number is the default password',
        } : null,
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        return res.status(409).json({ error: 'This flat already has an owner' });
      }
      if (
        error.message === 'OWNER_EMAIL_ALREADY_EXISTS' ||
        error.message === 'USER_EMAIL_ALREADY_EXISTS' ||
        error.message === 'USER_EMAIL_ALREADY_EXISTS_IN_SOCIETY'
      ) {
        return res.status(409).json({ error: 'Owner email already exists' });
      }
      return res.status(500).json({ error: 'Failed to create owner' });
    }
  },
);

router.put(
  '/owners/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // SECURITY: Verify owner belongs to admin's society
      const existing = await prisma.owner.findUnique({
        where: { id: req.params.id },
        include: { flat: { include: { block: { select: { societyId: true } } } } },
      });
      if (!existing) return res.status(404).json({ error: 'Owner not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && existing.flat.block.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const owner = await prisma.owner.update({
        where: { id: req.params.id },
        data: {
          name: req.body.name,
          phone: req.body.phone,
          email: req.body.email,
          altPhone: req.body.altPhone,
          aadharNo: req.body.aadharNo,
          panNo: req.body.panNo,
          moveInDate: req.body.moveInDate ? new Date(req.body.moveInDate) : undefined,
        },
      });
      return res.json(owner);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update owner' });
    }
  },
);

// ── TENANT CRUD ─────────────────────────────────────────
router.post(
  '/tenants',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [
    body('name').trim().notEmpty(),
    body('phone').notEmpty(),
    body('flatId').isUUID(),
    body('leaseStart').isISO8601(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // SECURITY: Verify flat belongs to admin's society
      const flat = await prisma.flat.findUnique({
        where: { id: req.body.flatId },
        include: { block: { select: { societyId: true } } },
      });
      if (!flat) return res.status(404).json({ error: 'Flat not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && flat.block.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const tenant = await prisma.tenant.create({
        data: {
          name: req.body.name,
          phone: req.body.phone,
          email: req.body.email || null,
          altPhone: req.body.altPhone || null,
          aadharNo: req.body.aadharNo || null,
          flatId: req.body.flatId,
          leaseStart: new Date(req.body.leaseStart),
          leaseEnd: req.body.leaseEnd ? new Date(req.body.leaseEnd) : null,
          rentAmount: req.body.rentAmount ? parseFloat(req.body.rentAmount) : null,
          deposit: req.body.deposit ? parseFloat(req.body.deposit) : null,
        },
      });
      return res.status(201).json(tenant);
    } catch (error: any) {
      if (error.code === 'P2002') {
        return res.status(409).json({ error: 'This flat already has a tenant' });
      }
      return res.status(500).json({ error: 'Failed to create tenant' });
    }
  },
);

router.put(
  '/tenants/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // SECURITY: Verify tenant belongs to admin's society
      const existing = await prisma.tenant.findUnique({
        where: { id: req.params.id },
        include: { flat: { include: { block: { select: { societyId: true } } } } },
      });
      if (!existing) return res.status(404).json({ error: 'Tenant not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && existing.flat.block.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const tenant = await prisma.tenant.update({
        where: { id: req.params.id },
        data: {
          name: req.body.name,
          phone: req.body.phone,
          email: req.body.email,
          altPhone: req.body.altPhone,
          aadharNo: req.body.aadharNo,
          leaseStart: req.body.leaseStart ? new Date(req.body.leaseStart) : undefined,
          leaseEnd: req.body.leaseEnd ? new Date(req.body.leaseEnd) : undefined,
          rentAmount: req.body.rentAmount !== undefined ? parseFloat(req.body.rentAmount) : undefined,
          deposit: req.body.deposit !== undefined ? parseFloat(req.body.deposit) : undefined,
          isActive: req.body.isActive,
        },
      });
      return res.json(tenant);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update tenant' });
    }
  },
);

// ── DOWNLOAD BULK FLAT TEMPLATE ──────────────────────────
router.get(
  '/bulk-upload/template',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  async (req: AuthRequest, res) => {
    try {
      const headers = [
        ['Block Name*', 'Flat Number*', 'Floor*', 'Type*', 'Area (sq.ft)', 'Owner Name', 'Owner Phone', 'Owner Email'],
      ];
      const sampleData = [
        ['A Wing', 'A-101', '1', 'TWO_BHK', '950', 'Rajesh Kumar', '9876543210', 'rajesh@email.com'],
        ['A Wing', 'A-102', '1', 'THREE_BHK', '1200', 'Priya Sharma', '9876543211', 'priya@email.com'],
        ['B Wing', 'B-201', '2', 'ONE_BHK', '650', '', '', ''],
      ];

      const ws = XLSX.utils.aoa_to_sheet([...headers, ...sampleData]);

      // Set column widths
      ws['!cols'] = [
        { wch: 15 }, { wch: 15 }, { wch: 8 }, { wch: 14 },
        { wch: 12 }, { wch: 20 }, { wch: 15 }, { wch: 25 },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Flats');

      // Add instructions sheet
      const instrData = [
        ['ApartEase - Bulk Flat Upload Template'],
        [''],
        ['Instructions:'],
        ['1. Fill in the flat details in the "Flats" sheet'],
        ['2. Fields marked with * are required'],
        ['3. Block Name must match an existing block in your society'],
        ['4. Valid flat types: ONE_BHK, TWO_BHK, THREE_BHK, FOUR_BHK, STUDIO, PENTHOUSE, SHOP, OTHER'],
        ['5. If Owner Phone and Owner Email are provided, a login account will be auto-created'],
        ['6. The default password for owner accounts will be their phone number'],
        ['7. Owners will be prompted to change their password on first login'],
        [''],
        ['Column Reference:'],
        ['Block Name* - Must match an existing block (e.g., "A Wing", "Tower 1")'],
        ['Flat Number* - Unique flat number within the block (e.g., "A-101")'],
        ['Floor* - Floor number (0 for ground floor)'],
        ['Type* - ONE_BHK, TWO_BHK, THREE_BHK, FOUR_BHK, STUDIO, PENTHOUSE, SHOP, OTHER'],
        ['Area (sq.ft) - Optional, numeric value'],
        ['Owner Name - Optional, name of the flat owner'],
        ['Owner Phone - Required if owner name is provided (10-digit Indian mobile)'],
        ['Owner Email - Optional, used for creating login account'],
      ];
      const instrWs = XLSX.utils.aoa_to_sheet(instrData);
      instrWs['!cols'] = [{ wch: 80 }];
      XLSX.utils.book_append_sheet(wb, instrWs, 'Instructions');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="flat_upload_template.xlsx"');
      return res.send(buffer);
    } catch (error: any) {
      logger.error('Template download failed', { error: error.message });
      return res.status(500).json({ error: 'Failed to generate template' });
    }
  },
);

// ── BULK UPLOAD FLATS FROM EXCEL ─────────────────────────
router.post(
  '/bulk-upload',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  async (req: AuthRequest, res) => {
    try {
      // express.raw() middleware pre-parses the body into req.body when
      // Content-Type matches. Use it directly; fall back to streaming for
      // any other client that hasn't triggered the middleware.
      let buffer: Buffer;
      if (Buffer.isBuffer(req.body) && req.body.length > 0) {
        buffer = req.body;
      } else {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        buffer = Buffer.concat(chunks);
      }

      if (buffer.length === 0) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (rows.length === 0) {
        return res.status(400).json({ error: 'Excel file is empty' });
      }

      // Get user's society blocks
      const societyId = req.user!.societyId;
      if (!societyId) {
        return res.status(400).json({ error: 'No society linked to your account' });
      }

      const blocks = await prisma.block.findMany({
        where: { societyId },
      });

      const blockMap = new Map(blocks.map((b) => [b.name.toLowerCase().trim(), b]));

      const results: { row: number; flatNumber: string; status: string; error?: string }[] = [];
      const validTypes = ['ONE_BHK', 'TWO_BHK', 'THREE_BHK', 'FOUR_BHK', 'STUDIO', 'PENTHOUSE', 'SHOP', 'OTHER'];
      let createdCount = 0;
      let errorCount = 0;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2; // Excel row (1-indexed header + data)

        // Map column names (flexible matching)
        const blockName = (row['Block Name*'] || row['Block Name'] || row['block name'] || '').toString().trim();
        const flatNumber = (row['Flat Number*'] || row['Flat Number'] || row['flat number'] || '').toString().trim();
        const floor = parseInt(row['Floor*'] || row['Floor'] || row['floor'] || '0');
        const type = (row['Type*'] || row['Type'] || row['type'] || 'TWO_BHK').toString().trim().toUpperCase();
        const areaSqFt = row['Area (sq.ft)'] || row['Area'] || row['area'];
        const ownerName = (row['Owner Name'] || row['owner name'] || '').toString().trim();
        const ownerPhone = (row['Owner Phone'] || row['owner phone'] || '').toString().trim();
        const ownerEmail = (row['Owner Email'] || row['owner email'] || '').toString().trim();

        // Validate required fields
        if (!blockName || !flatNumber) {
          results.push({ row: rowNum, flatNumber: flatNumber || '(empty)', status: 'error', error: 'Block Name and Flat Number are required' });
          errorCount++;
          continue;
        }

        if (isNaN(floor)) {
          results.push({ row: rowNum, flatNumber, status: 'error', error: 'Invalid floor number' });
          errorCount++;
          continue;
        }

        if (!validTypes.includes(type)) {
          results.push({ row: rowNum, flatNumber, status: 'error', error: `Invalid type "${type}". Must be one of: ${validTypes.join(', ')}` });
          errorCount++;
          continue;
        }

        const block = blockMap.get(blockName.toLowerCase());
        if (!block) {
          results.push({ row: rowNum, flatNumber, status: 'error', error: `Block "${blockName}" not found in your society. Available: ${blocks.map(b => b.name).join(', ')}` });
          errorCount++;
          continue;
        }

        try {
          await prisma.$transaction(async (tx) => {
            // Create flat
            const flat = await tx.flat.create({
              data: {
                flatNumber,
                floor,
                type: type as any,
                areaSqFt: areaSqFt ? parseFloat(areaSqFt) : null,
                blockId: block.id,
                isOccupied: !!ownerName,
              },
            });

            // Create owner + user if owner details provided
            if (ownerName && ownerPhone) {
              let userId: string | null = null;
              const normalizedOwnerEmail = ownerEmail ? ownerEmail.toLowerCase() : '';

              if (normalizedOwnerEmail) {
                const existingOwner = await tx.owner.findFirst({
                  where: {
                    email: normalizedOwnerEmail,
                    flat: { block: { societyId } },
                  },
                  select: { id: true },
                });
                if (existingOwner) {
                  throw new Error('OWNER_EMAIL_ALREADY_EXISTS');
                }

                const existingUser = await tx.user.findUnique({
                  where: { email: normalizedOwnerEmail },
                  select: { id: true },
                });
                if (existingUser) {
                  const sameSocietyMembership = await tx.userSocietyMembership.findUnique({
                    where: { userId_societyId: { userId: existingUser.id, societyId } },
                    select: { id: true },
                  });
                  if (sameSocietyMembership) {
                    throw new Error('USER_EMAIL_ALREADY_EXISTS_IN_SOCIETY');
                  }

                  await tx.userSocietyMembership.create({
                    data: {
                      userId: existingUser.id,
                      societyId,
                      role: 'OWNER',
                    },
                  });
                  userId = existingUser.id;
                } else {
                  const passwordHash = await bcrypt.hash(ownerPhone, 12);
                  const newUser = await tx.user.create({
                    data: {
                      email: normalizedOwnerEmail,
                      passwordHash,
                      name: ownerName,
                      phone: ownerPhone,
                      role: 'OWNER',
                      societyId,
                      activeSocietyId: societyId,
                      mustChangePassword: true,
                    },
                  });
                  await tx.userSocietyMembership.create({
                    data: {
                      userId: newUser.id,
                      societyId,
                      role: 'OWNER',
                    },
                  });
                  userId = newUser.id;
                }
              }

              await tx.owner.create({
                data: {
                  name: ownerName,
                  phone: ownerPhone,
                  email: normalizedOwnerEmail || null,
                  flatId: flat.id,
                  userId,
                },
              });
            }
          });

          results.push({ row: rowNum, flatNumber, status: 'success' });
          createdCount++;
        } catch (error: any) {
          let msg = error.code === 'P2002' ? 'Flat already exists in this block' : error.message;
          if (
            error.message === 'OWNER_EMAIL_ALREADY_EXISTS' ||
            error.message === 'USER_EMAIL_ALREADY_EXISTS' ||
            error.message === 'USER_EMAIL_ALREADY_EXISTS_IN_SOCIETY'
          ) {
            msg = 'Owner email already exists';
          }
          results.push({ row: rowNum, flatNumber, status: 'error', error: msg });
          errorCount++;
        }
      }

      logger.info('Bulk flat upload completed', {
        userId: req.user!.id,
        societyId,
        total: rows.length,
        created: createdCount,
        errors: errorCount,
      });

      return res.json({
        message: `Processed ${rows.length} rows: ${createdCount} created, ${errorCount} errors`,
        total: rows.length,
        created: createdCount,
        errors: errorCount,
        results,
      });
    } catch (error: any) {
      logger.error('Bulk upload failed', { error: error.message });
      return res.status(500).json({ error: 'Failed to process bulk upload' });
    }
  },
);

export default router;
