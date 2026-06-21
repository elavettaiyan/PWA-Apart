import { NextFunction, Response, Router } from 'express';
import { body, param, query } from 'express-validator';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest, SOCIETY_MANAGERS } from '../../middleware/auth';
import { getFileUrl, upload } from '../../middleware/upload';
import { validate } from '../../middleware/errorHandler';
import logger from '../../config/logger';
import { sendResidentOnboardingEmail } from '../../config/email';
import { runMemberRemoval } from '../members/removal';
import { computeTrialStatus, TRIAL_FLAT_LIMIT } from '../premium/routes';
import { createTenantProfileChangeApproval, createTenantRegistrationApproval, getApprovalConfig } from '../approvals/service';

const router = Router();
const FLAT_FEATURES = ['BALCONY', 'CENTRAL_AC'] as const;

function sanitizeFlatFeatures(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((value) => String(value || '').trim().toUpperCase())
        .filter((value): value is (typeof FLAT_FEATURES)[number] => FLAT_FEATURES.includes(value as (typeof FLAT_FEATURES)[number])),
    ),
  );
}
const FREE_TIER_FLAT_LIMIT = 5;
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
const PARKING_TYPES = ['NONE', 'OPEN', 'COVERED'] as const;
const VEHICLE_TYPES = ['TWO_WHEELER', 'THREE_WHEELER', 'FOUR_WHEELER'] as const;
const residentVehicleSelect = {
  id: true,
  type: true,
  registrationNumber: true,
} as const;

function normalizeIndianMobileNumber(value: string): string {
  const digitsOnly = String(value || '').replace(/\D/g, '');

  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    return digitsOnly.slice(2);
  }

  if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
    return digitsOnly.slice(1);
  }

  return digitsOnly;
}

function normalizeRegistrationValue(value: unknown) {
  const trimmed = String(value ?? '').trim().toUpperCase();
  return trimmed ? trimmed : null;
}

function parseJsonBodyField(req: AuthRequest, res: Response, next: NextFunction) {
  if (typeof req.body.vehicles === 'string') {
    try {
      req.body.vehicles = JSON.parse(req.body.vehicles);
    } catch {
      return res.status(400).json({ error: 'Vehicles must be a valid JSON array' });
    }
  }

  next();
}

type NormalizedResidentVehicle = {
  type: (typeof VEHICLE_TYPES)[number];
  registrationNumber: string;
};

function sanitizeResidentVehicles(input: unknown): NormalizedResidentVehicle[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const vehicles: NormalizedResidentVehicle[] = [];

  for (const item of input) {
    const type = String((item as any)?.type || '').trim().toUpperCase();
    const registrationNumber = normalizeRegistrationValue((item as any)?.registrationNumber);

    if (!VEHICLE_TYPES.includes(type as (typeof VEHICLE_TYPES)[number]) || !registrationNumber) {
      continue;
    }

    const dedupeKey = `${type}:${registrationNumber}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    vehicles.push({
      type: type as (typeof VEHICLE_TYPES)[number],
      registrationNumber,
    });
  }

  return vehicles;
}

function getResidentVehiclesFromLegacyFields(input: { carNumber?: unknown; twoWheelerNumber?: unknown }): NormalizedResidentVehicle[] {
  const vehicles: NormalizedResidentVehicle[] = [];
  const carNumber = normalizeRegistrationValue(input.carNumber);
  const twoWheelerNumber = normalizeRegistrationValue(input.twoWheelerNumber);

  if (carNumber) {
    vehicles.push({ type: 'FOUR_WHEELER', registrationNumber: carNumber });
  }

  if (twoWheelerNumber) {
    vehicles.push({ type: 'TWO_WHEELER', registrationNumber: twoWheelerNumber });
  }

  return vehicles;
}

function buildLegacyVehicleFields(vehicles: NormalizedResidentVehicle[]) {
  return {
    carNumber: vehicles.find((vehicle) => vehicle.type === 'FOUR_WHEELER')?.registrationNumber ?? null,
    twoWheelerNumber: vehicles.find((vehicle) => vehicle.type === 'TWO_WHEELER')?.registrationNumber ?? null,
  };
}

async function findUserByEmailInsensitive(tx: any, email: string, select?: Record<string, boolean>) {
  const normalizedEmail = String(email || '').trim().toLowerCase();

  return tx.user.findFirst({
    where: {
      email: {
        equals: normalizedEmail,
        mode: 'insensitive',
      },
    },
    orderBy: { createdAt: 'asc' },
    ...(select ? { select } : {}),
  });
}

function getLinkedMembershipRole(
  existingUser: { role: string; societyId?: string | null; activeSocietyId?: string | null },
  societyId: string,
  fallbackRole: 'OWNER' | 'TENANT',
) {
  if (existingUser.societyId === societyId || existingUser.activeSocietyId === societyId) {
    return existingUser.role;
  }

  return fallbackRole;
}

function getRequestSocietyId(req: AuthRequest) {
  return req.user?.activeSocietyId || req.user?.societyId || null;
}

async function findActiveOwnerMappingForUser(userId: string, societyId: string, excludeFlatId?: string) {
  return prisma.owner.findFirst({
    where: {
      userId,
      isActive: true,
      ...(excludeFlatId ? { flatId: { not: excludeFlatId } } : {}),
      flat: {
        block: {
          societyId,
        },
      },
    },
    include: {
      flat: {
        include: {
          block: { select: { name: true } },
        },
      },
    },
  });
}

// All routes require authentication
router.use(authenticate);

function buildMyFlatInclude(year?: number): Prisma.FlatInclude {
  return {
    block: {
      include: {
        society: { select: { id: true, name: true } },
      },
    },
    owner: {
      include: {
        vehicles: { select: residentVehicleSelect, orderBy: { createdAt: 'asc' } },
      },
    },
    tenant: {
      include: {
        vehicles: { select: residentVehicleSelect, orderBy: { createdAt: 'asc' } },
      },
    },
    visitors: {
      orderBy: { checkedInAt: 'desc' },
      take: 5,
      include: {
        capturedBy: { select: { name: true } },
      },
    },
    deliveries: {
      orderBy: { deliveredAt: 'desc' },
      take: 5,
      include: {
        capturedBy: { select: { name: true } },
      },
    },
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

function normalizeResidentTextValue(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeOptionalResidentCount(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveLegacyVehicleNumbers(vehicles: Array<{ type: 'TWO_WHEELER' | 'THREE_WHEELER' | 'FOUR_WHEELER'; registrationNumber: string }>) {
  const firstFourWheeler = vehicles.find((vehicle) => vehicle.type === 'FOUR_WHEELER')?.registrationNumber || null;
  const firstTwoWheeler = vehicles.find((vehicle) => vehicle.type === 'TWO_WHEELER')?.registrationNumber || null;

  return {
    carNumber: firstFourWheeler,
    twoWheelerNumber: firstTwoWheeler,
  };
}

async function getFlatLimitStatus(societyId: string) {
  const [flatCount, activeSubscription, society] = await Promise.all([
    prisma.flat.count({ where: { block: { societyId } } }),
    prisma.premiumSubscription.findFirst({
      where: { societyId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: { includedFlatCount: true },
    }),
    prisma.society.findUnique({
      where: { id: societyId },
      select: { trialStartedAt: true, trialEndsAt: true },
    }),
  ]);

  if (!activeSubscription) {
    const trial = computeTrialStatus(society?.trialStartedAt, society?.trialEndsAt);
    const cap = trial.flatLimit;
    if (trial.isOnTrial) {
      return {
        flatCount,
        reached: flatCount >= cap,
        code: 'TRIAL_FLAT_LIMIT_REACHED',
        message: `You have reached the trial limit of ${cap} flats. Upgrade to Premium to add more.`,
        minimumRequiredFlatCount: flatCount + 1,
        includedFlatCount: cap,
      };
    }
    return {
      flatCount,
      reached: flatCount >= cap,
      code: 'FREE_TIER_LIMIT_REACHED',
      message: `You have reached the maximum of ${FREE_TIER_FLAT_LIMIT} flats on the free tier. Please upgrade to Premium to add more.`,
      minimumRequiredFlatCount: flatCount + 1,
      includedFlatCount: cap,
    };
  }

  return {
    flatCount,
    reached: flatCount >= activeSubscription.includedFlatCount,
    code: 'PREMIUM_FLAT_CAPACITY_REACHED',
    message: `You have reached your purchased Premium capacity of ${activeSubscription.includedFlatCount} flats. Increase your Premium flat count to add more.`,
    minimumRequiredFlatCount: Math.max(flatCount, activeSubscription.includedFlatCount) + 1,
    includedFlatCount: activeSubscription.includedFlatCount,
  };
}

async function getOutstandingFlatDue(flatId: string) {
  const totals = await prisma.maintenanceBill.aggregate({
    where: {
      flatId,
      status: { in: ['PENDING', 'OVERDUE', 'PARTIAL'] },
    },
    _sum: {
      totalAmount: true,
      paidAmount: true,
    },
  });

  return Number(Math.max(0, (totals._sum.totalAmount || 0) - (totals._sum.paidAmount || 0)).toFixed(2));
}

async function shouldDeleteResidentMembership(
  tx: Prisma.TransactionClient,
  args: {
    userId?: string | null;
    societyId: string;
    userRole?: string | null;
    excludeOwnerId?: string | null;
    excludeTenantId?: string | null;
  },
) {
  if (!args.userId) return false;
  if (args.userRole && !['OWNER', 'TENANT'].includes(args.userRole)) {
    return false;
  }

  const [remainingOwner, remainingTenant] = await Promise.all([
    tx.owner.findFirst({
      where: {
        userId: args.userId,
        isActive: true,
        ...(args.excludeOwnerId ? { id: { not: args.excludeOwnerId } } : {}),
        flat: { block: { societyId: args.societyId } },
      },
      select: { id: true },
    }),
    tx.tenant.findFirst({
      where: {
        userId: args.userId,
        isActive: true,
        ...(args.excludeTenantId ? { id: { not: args.excludeTenantId } } : {}),
        flat: { block: { societyId: args.societyId } },
      },
      select: { id: true },
    }),
  ]);

  return !remainingOwner && !remainingTenant;
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

router.get('/options', authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS, 'SERVICE_STAFF'), async (req: AuthRequest, res: Response) => {
  try {
    const societyId = req.user!.societyId;
    if (!societyId) return res.status(400).json({ error: 'Society ID required' });

    const flats = await prisma.flat.findMany({
      where: { block: { societyId } },
      select: {
        id: true,
        flatNumber: true,
        floor: true,
        block: { select: { name: true } },
        owner: { select: { name: true } },
        tenant: { select: { name: true, isActive: true } },
      },
      orderBy: [{ floor: 'asc' }, { flatNumber: 'asc' }],
    });

    return res.json(
      flats
        .map((flat) => ({
          id: flat.id,
          flatNumber: flat.flatNumber,
          floor: flat.floor,
          blockName: flat.block.name,
          residentName: flat.tenant?.isActive ? flat.tenant.name : flat.owner?.name || null,
        }))
        .sort((left, right) => {
          const blockCompare = left.blockName.localeCompare(right.blockName);
          if (blockCompare !== 0) return blockCompare;
          return left.flatNumber.localeCompare(right.flatNumber, undefined, { numeric: true, sensitivity: 'base' });
        }),
    );
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch flat options' });
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
              carNumber: true,
              twoWheelerNumber: true,
              userId: true,
              aadharNo: true,
              panNo: true,
              altPhone: true,
              moveInDate: true,
              isActive: true,
              deactivatedAt: true,
              deactivationReason: true,
              vehicles: { select: residentVehicleSelect, orderBy: { createdAt: 'asc' } },
            },
          },
          tenant: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              carNumber: true,
              twoWheelerNumber: true,
              leaseStart: true,
              leaseEnd: true,
              rentAmount: true,
              deposit: true,
              isActive: true,
              deactivatedAt: true,
              deactivationReason: true,
              vehicles: { select: residentVehicleSelect, orderBy: { createdAt: 'asc' } },
            },
          },
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
        owner: { include: { vehicles: { select: residentVehicleSelect, orderBy: { createdAt: 'asc' } } } },
        tenant: { include: { vehicles: { select: residentVehicleSelect, orderBy: { createdAt: 'asc' } } } },
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

router.post(
  '/flats/:id/assign-me',
  authorize('ADMIN'),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = getRequestSocietyId(req);
      if (!societyId) {
        return res.status(400).json({ error: 'Society ID required' });
      }

      const flat = await prisma.flat.findUnique({
        where: { id: req.params.id },
        include: {
          block: { select: { societyId: true, name: true, society: { select: { name: true } } } },
          owner: { select: { id: true, userId: true, isActive: true } },
        },
      });

      if (!flat) {
        return res.status(404).json({ error: 'Flat not found' });
      }

      if (flat.block.societyId !== societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (flat.owner?.isActive) {
        if (flat.owner.userId === req.user!.id) {
          return res.status(409).json({ error: 'This flat is already set as your flat.' });
        }

        return res.status(409).json({ error: 'This flat already has an active owner.' });
      }

      const existingOwnerMapping = await findActiveOwnerMappingForUser(req.user!.id, societyId, flat.id);
      if (existingOwnerMapping) {
        return res.status(409).json({
          error: `You are already mapped to ${existingOwnerMapping.flat.block?.name ? `${existingOwnerMapping.flat.block.name} - ` : ''}${existingOwnerMapping.flat.flatNumber}. Remove that mapping before setting another flat as yours.`,
        });
      }

      const userRecord = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          societyId: true,
          activeSocietyId: true,
        },
      });

      if (!userRecord) {
        return res.status(404).json({ error: 'User not found' });
      }

      const normalizedPhone = normalizeIndianMobileNumber(userRecord.phone || '');
      if (!INDIAN_MOBILE_REGEX.test(normalizedPhone)) {
        return res.status(409).json({ error: 'Add a valid 10-digit mobile number to your profile before setting a flat as your own.' });
      }

      const owner = await prisma.$transaction(async (tx) => {
        const ownerData = {
          name: userRecord.name,
          phone: normalizedPhone,
          email: userRecord.email ? String(userRecord.email).trim().toLowerCase() : null,
          flatId: flat.id,
          moveInDate: new Date(),
          userId: userRecord.id,
          isActive: true,
          deactivatedAt: null,
          deactivationReason: null,
        };

        const createdOwner = flat.owner?.id
          ? await tx.owner.update({
              where: { id: flat.owner.id },
              data: ownerData,
            })
          : await tx.owner.create({
              data: ownerData,
            });

        await tx.flat.update({
          where: { id: flat.id },
          data: { isOccupied: true },
        });

        return createdOwner;
      });

      logger.info('Admin self-assigned flat', {
        ownerId: owner.id,
        flatId: flat.id,
        userId: req.user!.id,
      });

      return res.status(201).json({ message: 'Flat set as your flat successfully', owner });
    } catch (error: any) {
      logger.error('Failed to self-assign flat', { error: error.message, flatId: req.params.id, userId: req.user?.id });
      return res.status(500).json({ error: 'Failed to set this flat as your flat' });
    }
  },
);

router.delete(
  '/flats/:id/assign-me',
  authorize('ADMIN'),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = getRequestSocietyId(req);
      if (!societyId) {
        return res.status(400).json({ error: 'Society ID required' });
      }

      const existing = await prisma.owner.findFirst({
        where: {
          flatId: req.params.id,
          isActive: true,
        },
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
          flat: { include: { block: { select: { societyId: true, name: true, society: { select: { name: true } } } }, tenant: { select: { id: true, isActive: true } } } },
        },
      });

      if (!existing) {
        return res.status(404).json({ error: 'Your flat mapping was not found' });
      }

      if (existing.flat.block.societyId !== societyId || existing.userId !== req.user!.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const outstandingDue = await getOutstandingFlatDue(existing.flatId);
      if (outstandingDue > 0) {
        return res.status(409).json({ error: `Cannot remove your flat mapping while the flat has outstanding dues of Rs. ${outstandingDue.toFixed(2)}.` });
      }

      await runMemberRemoval({
        societyId,
        societyName: existing.flat.block.society?.name || 'your society',
        targetUserId: existing.userId,
        targetRole: 'OWNER',
        removedByUserId: req.user!.id,
        removedByRole: req.user!.role as any,
        reason: 'ADMIN_SELF_UNMAP',
        source: 'FLAT_MANAGEMENT',
        recipientEmail: null,
        recipientName: existing.user?.name || existing.name,
        ownerId: existing.id,
        flatId: existing.flatId,
        snapshot: {
          name: existing.name,
          email: existing.email,
          phone: existing.phone,
          flatNumber: existing.flat.flatNumber,
          blockName: existing.flat.block.name,
        },
        removeData: async (tx) => {
          await tx.owner.update({
            where: { id: existing.id },
            data: {
              isActive: false,
              deactivatedAt: new Date(),
              deactivationReason: 'ADMIN_SELF_UNMAP',
            },
          });

          const hasActiveTenant = await tx.tenant.findFirst({
            where: { flatId: existing.flatId, isActive: true },
            select: { id: true },
          });

          await tx.flat.update({
            where: { id: existing.flatId },
            data: { isOccupied: !!hasActiveTenant },
          });
        },
        deleteMembership: false,
      });

      logger.info('Admin removed self flat mapping', {
        ownerId: existing.id,
        flatId: existing.flatId,
        userId: req.user!.id,
      });

      return res.json({ message: 'Flat removed from your profile successfully' });
    } catch (error: any) {
      logger.error('Failed to remove self flat mapping', { error: error.message, flatId: req.params.id, userId: req.user?.id });
      return res.status(500).json({ error: 'Failed to remove this flat from your profile' });
    }
  },
);

// ── CREATE FLAT ─────────────────────────────────────────
router.post(
  '/flats',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [
    body('flatNumber').trim().notEmpty(),
    body('floor').isInt({ min: 0 }),
    body('type').isIn(['ONE_BHK', 'TWO_BHK', 'THREE_BHK', 'FOUR_BHK', 'STUDIO', 'PENTHOUSE', 'SHOP', 'OTHER']),
    body('areaSqFt').optional().isFloat({ min: 0 }),
    body('keyFeatures').optional().isArray({ max: 8 }).withMessage('Key features must be an array'),
    body('keyFeatures.*').optional().isIn(FLAT_FEATURES).withMessage('Invalid flat feature'),
    body('parkingType').optional().isIn(PARKING_TYPES).withMessage('Invalid parking type'),
    body('parkingSlotNumber').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Parking slot number is too long'),
    body('blockId').isUUID(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // SECURITY: Verify block belongs to admin's society
      const block = await prisma.block.findUnique({ 
        where: { id: req.body.blockId },
        include: { society: true }
      });
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
          keyFeatures: sanitizeFlatFeatures(req.body.keyFeatures),
          parkingType: req.body.parkingType || 'NONE',
          parkingSlotNumber: req.body.parkingType && req.body.parkingType !== 'NONE'
            ? normalizeRegistrationValue(req.body.parkingSlotNumber)
            : null,
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
  [
    param('id').isUUID(),
    body('flatNumber').optional().trim().notEmpty(),
    body('floor').optional().isInt({ min: 0 }),
    body('type').optional().isIn(['ONE_BHK', 'TWO_BHK', 'THREE_BHK', 'FOUR_BHK', 'STUDIO', 'PENTHOUSE', 'SHOP', 'OTHER']),
    body('areaSqFt').optional({ values: 'null' }).isFloat({ min: 0 }),
    body('keyFeatures').optional().isArray({ max: 8 }).withMessage('Key features must be an array'),
    body('keyFeatures.*').optional().isIn(FLAT_FEATURES).withMessage('Invalid flat feature'),
    body('isOccupied').optional().isBoolean(),
  ],
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
          keyFeatures: req.body.keyFeatures !== undefined ? sanitizeFlatFeatures(req.body.keyFeatures) : undefined,
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
  [
    body('name').trim().notEmpty(),
    body('totalWings').optional({ values: 'falsy' }).isInt({ min: 1 }),
    body('floors').isInt({ min: 1 }),
    body('description').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
    body('societyId').isUUID(),
  ],
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
          totalWings: req.body.totalWings ? Number(req.body.totalWings) : null,
          floors: req.body.floors,
          description: req.body.description?.trim() || null,
          societyId,
        },
      });
      return res.status(201).json(block);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create block' });
    }
  },
);

router.put(
  '/blocks/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [
    param('id').isUUID(),
    body('name').optional().trim().notEmpty(),
    body('totalWings').optional({ values: 'falsy' }).isInt({ min: 1 }),
    body('floors').optional().isInt({ min: 1 }),
    body('description').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const existing = await prisma.block.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Block not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && existing.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const block = await prisma.block.update({
        where: { id: req.params.id },
        data: {
          name: req.body.name,
          totalWings: req.body.totalWings !== undefined ? Number(req.body.totalWings) : undefined,
          floors: req.body.floors,
          description: req.body.description !== undefined ? (req.body.description?.trim() || null) : undefined,
        },
      });

      return res.json(block);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update block' });
    }
  },
);

router.delete(
  '/blocks/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const existing = await prisma.block.findUnique({
        where: { id: req.params.id },
        include: { _count: { select: { flats: true } } },
      });
      if (!existing) return res.status(404).json({ error: 'Block not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && existing.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (existing._count.flats > 0) {
        return res.status(409).json({ error: 'Only blocks without mapped flats can be deleted' });
      }

      await prisma.block.delete({ where: { id: req.params.id } });
      return res.json({ message: 'Block deleted successfully' });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to delete block' });
    }
  },
);

// ── OWNER CRUD ──────────────────────────────────────────
router.post(
  '/owners',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [
    body('name').trim().notEmpty().withMessage('Owner name is required'),
    body('phone').trim().customSanitizer(normalizeIndianMobileNumber).matches(INDIAN_MOBILE_REGEX).withMessage('Phone must be a valid 10-digit Indian mobile number'),
    body('email').optional({ values: 'falsy' }).trim().isEmail().withMessage('Invalid email address'),
    body('vehicles').optional().isArray({ max: 10 }).withMessage('Vehicles must be an array'),
    body('vehicles.*.type').optional().isIn(VEHICLE_TYPES).withMessage('Invalid vehicle type'),
    body('vehicles.*.registrationNumber').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Vehicle registration number is too long'),
    body('carNumber').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Car number is too long'),
    body('twoWheelerNumber').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Two wheeler number is too long'),
    body('flatId').isUUID(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const vehicles = req.body.vehicles !== undefined
        ? sanitizeResidentVehicles(req.body.vehicles)
        : getResidentVehiclesFromLegacyFields(req.body);
      const legacyVehicleFields = buildLegacyVehicleFields(vehicles);

      // SECURITY: Verify flat belongs to admin's society
      const flat = await prisma.flat.findUnique({
        where: { id: req.body.flatId },
        include: { block: true, owner: { select: { id: true, isActive: true } } },
      });
      if (!flat) return res.status(404).json({ error: 'Flat not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && flat.block.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      if (flat.owner?.isActive) {
        return res.status(409).json({ error: 'This flat already has an active owner' });
      }

      // SECURITY: Whitelist allowed fields
      // Use a transaction to create owner + user account atomically
      const result = await prisma.$transaction(async (tx) => {
        const normalizedEmail = req.body.email ? String(req.body.email).trim().toLowerCase() : '';

        if (normalizedEmail) {
          const existingOwner = await tx.owner.findFirst({
            where: {
              email: {
                equals: normalizedEmail,
                mode: 'insensitive',
              },
              isActive: true,
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
        let createdNewUser = false;
        if (req.body.email && req.body.phone) {
          const normalizedOwnerEmail = String(req.body.email).trim().toLowerCase();

          const existingUser = await findUserByEmailInsensitive(tx, normalizedOwnerEmail, {
            id: true,
            role: true,
            societyId: true,
            activeSocietyId: true,
          });

          if (existingUser) {
            // If user already belongs to this society (e.g. admin who also owns a flat), reuse them
            const sameSocietyMembership = await tx.userSocietyMembership.findUnique({
              where: { userId_societyId: { userId: existingUser.id, societyId: flat.block.societyId } },
              select: { id: true },
            });
            if (!sameSocietyMembership) {
              await tx.userSocietyMembership.create({
                data: {
                  userId: existingUser.id,
                  societyId: flat.block.societyId,
                  role: getLinkedMembershipRole(existingUser, flat.block.societyId, 'OWNER') as any,
                },
              });
            }
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
            createdNewUser = true;
          }
        }

        const ownerData = {
          name: req.body.name,
          phone: req.body.phone,
          email: req.body.email ? String(req.body.email).trim().toLowerCase() : null,
          ...legacyVehicleFields,
          altPhone: req.body.altPhone || null,
          aadharNo: req.body.aadharNo || null,
          panNo: req.body.panNo || null,
          flatId: req.body.flatId,
          moveInDate: req.body.moveInDate ? new Date(req.body.moveInDate) : null,
          userId,
          isActive: true,
          deactivatedAt: null,
          deactivationReason: null,
        };

        const owner = flat.owner?.id
          ? await tx.owner.update({
              where: { id: flat.owner.id },
              data: {
                ...ownerData,
                vehicles: {
                  deleteMany: {},
                  ...(vehicles.length ? { create: vehicles } : {}),
                },
              },
            })
          : await tx.owner.create({
              data: {
                ...ownerData,
                ...(vehicles.length ? { vehicles: { create: vehicles } } : {}),
              },
            });

        // Mark flat as occupied
        await tx.flat.update({
          where: { id: req.body.flatId },
          data: { isOccupied: true },
        });

        return { owner, accountLinked: !!userId, accountCreated: createdNewUser };
      });

      logger.info('Owner created', {
        ownerId: result.owner.id,
        flatId: req.body.flatId,
        accountLinked: result.accountLinked,
        accountCreated: result.accountCreated,
      });

      if (req.body.email && req.body.phone && result.accountLinked) {
        prisma.block.findUnique({
          where: { id: flat.blockId },
          include: { society: { select: { name: true } } },
        }).then((blockRecord) => {
          return sendResidentOnboardingEmail(String(req.body.email).trim().toLowerCase(), {
            userName: req.body.name,
            societyName: blockRecord?.society?.name || 'your society',
            flatNumber: flat.flatNumber,
            blockName: flat.block?.name || blockRecord?.name || null,
            relation: 'OWNER',
            loginEmail: String(req.body.email).trim().toLowerCase(),
            phoneNumber: req.body.phone,
            accountCreated: result.accountCreated,
          });
        }).catch((emailError: any) => {
          logger.error('Resident onboarding email failed for owner', {
            flatId: req.body.flatId,
            email: req.body.email,
            error: emailError.message,
          });
        });
      }

      return res.status(201).json({
        ...result.owner,
        userCreated: result.accountLinked,
        loginInfo: result.accountLinked ? {
          email: req.body.email,
          defaultPassword: result.accountCreated ? 'Phone number is the default password' : 'Use existing password or reset it from the login screen',
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
  [
    param('id').isUUID(),
    body('name').optional().trim().notEmpty().withMessage('Owner name is required'),
    body('phone').optional().trim().customSanitizer(normalizeIndianMobileNumber).matches(INDIAN_MOBILE_REGEX).withMessage('Phone must be a valid 10-digit Indian mobile number'),
    body('email').optional({ values: 'falsy' }).trim().isEmail().withMessage('Invalid email address'),
    body('vehicles').optional().isArray({ max: 10 }).withMessage('Vehicles must be an array'),
    body('vehicles.*.type').optional().isIn(VEHICLE_TYPES).withMessage('Invalid vehicle type'),
    body('vehicles.*.registrationNumber').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Vehicle registration number is too long'),
    body('carNumber').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Car number is too long'),
    body('twoWheelerNumber').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Two wheeler number is too long'),
  ],
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

      const societyId = existing.flat.block.societyId;
      const normalizedEmail = req.body.email ? String(req.body.email).trim().toLowerCase() : null;
      const hasVehicleArray = req.body.vehicles !== undefined;
      const vehicles = hasVehicleArray ? sanitizeResidentVehicles(req.body.vehicles) : [];
      const legacyVehicleFields = hasVehicleArray ? buildLegacyVehicleFields(vehicles) : null;

      // Re-link userId when email changes OR when userId is null (e.g. after account deletion)
      let userId: string | undefined;
      const emailToLookup = normalizedEmail || existing.email;
      if (emailToLookup && (normalizedEmail !== existing.email || !existing.userId)) {
        const matchedUser = await findUserByEmailInsensitive(prisma, emailToLookup, {
          id: true,
          role: true,
          societyId: true,
          activeSocietyId: true,
        });
        if (matchedUser) {
          userId = matchedUser.id;
          // Ensure society membership exists
          const membership = await prisma.userSocietyMembership.findUnique({
            where: { userId_societyId: { userId: matchedUser.id, societyId } },
          });
          if (!membership) {
            await prisma.userSocietyMembership.create({
              data: {
                userId: matchedUser.id,
                societyId,
                role: getLinkedMembershipRole(matchedUser, societyId, 'OWNER') as any,
              },
            });
          }
        }
      }

      const owner = await prisma.$transaction(async (tx) => {
        const updatedOwner = await tx.owner.update({
          where: { id: req.params.id },
          data: {
            name: req.body.name,
            phone: req.body.phone,
            email: normalizedEmail,
            carNumber: legacyVehicleFields
              ? legacyVehicleFields.carNumber
              : req.body.carNumber !== undefined
                ? normalizeRegistrationValue(req.body.carNumber)
                : undefined,
            twoWheelerNumber: legacyVehicleFields
              ? legacyVehicleFields.twoWheelerNumber
              : req.body.twoWheelerNumber !== undefined
                ? normalizeRegistrationValue(req.body.twoWheelerNumber)
                : undefined,
            altPhone: req.body.altPhone,
            aadharNo: req.body.aadharNo,
            panNo: req.body.panNo,
            moveInDate: req.body.moveInDate ? new Date(req.body.moveInDate) : undefined,
            ...(userId !== undefined ? { userId } : {}),
            ...(hasVehicleArray
              ? {
                  vehicles: {
                    deleteMany: {},
                    ...(vehicles.length ? { create: vehicles } : {}),
                  },
                }
              : {}),
          },
        });

        if (updatedOwner.userId && (req.body.name !== undefined || req.body.phone !== undefined || normalizedEmail !== null)) {
          await tx.user.update({
            where: { id: updatedOwner.userId },
            data: {
              name: req.body.name,
              phone: req.body.phone,
              email: normalizedEmail || undefined,
            },
          });
        }

        return updatedOwner;
      });

      return res.json(owner);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update owner' });
    }
  },
);

router.delete(
  '/owners/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [
    param('id').isUUID(),
    body('reason').trim().notEmpty().withMessage('Reason is required'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const existing = await prisma.owner.findUnique({
        where: { id: req.params.id },
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
          flat: { include: { block: { select: { societyId: true, name: true } }, tenant: { select: { id: true, isActive: true } } } },
        },
      });

      if (!existing) return res.status(404).json({ error: 'Owner not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && existing.flat.block.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      if (!existing.isActive) {
        return res.status(409).json({ error: 'Owner is already deactivated' });
      }

      const outstandingDue = await getOutstandingFlatDue(existing.flatId);
      if (outstandingDue > 0) {
        return res.status(409).json({ error: `Cannot deactivate resident while flat has outstanding dues of Rs. ${outstandingDue.toFixed(2)}.` });
      }

      const societyId = existing.flat.block.societyId;
      const reason = String(req.body.reason || '').trim();
      const society = await prisma.society.findUnique({ where: { id: societyId }, select: { name: true } });

      await runMemberRemoval({
        societyId,
        societyName: society?.name || 'your society',
        targetUserId: existing.userId,
        targetRole: 'OWNER',
        removedByUserId: req.user!.id,
        removedByRole: req.user!.role as any,
        reason,
        source: 'FLAT_MANAGEMENT',
        recipientEmail: null,
        recipientName: existing.user?.name || existing.name,
        ownerId: existing.id,
        flatId: existing.flatId,
        snapshot: {
          name: existing.name,
          email: existing.email,
          phone: existing.phone,
          flatNumber: existing.flat.flatNumber,
          blockName: existing.flat.block.name,
        },
        removeData: async (tx) => {
          await tx.owner.update({
            where: { id: existing.id },
            data: {
              isActive: false,
              deactivatedAt: new Date(),
              deactivationReason: reason,
            },
          });

          const hasActiveTenant = await tx.tenant.findFirst({
            where: { flatId: existing.flatId, isActive: true },
            select: { id: true },
          });

          await tx.flat.update({
            where: { id: existing.flatId },
            data: { isOccupied: !!hasActiveTenant },
          });
        },
        deleteMembership: async (tx) => shouldDeleteResidentMembership(tx, {
          userId: existing.userId,
          societyId,
          userRole: existing.user?.role,
          excludeOwnerId: existing.id,
        }),
      });

      return res.json({ message: 'Owner deactivated successfully' });
    } catch (error: any) {
      logger.error('Failed to deactivate owner', { error: error.message, ownerId: req.params.id });
      return res.status(500).json({ error: 'Failed to deactivate owner' });
    }
  },
);

// Reset owner login — reactivates or creates a user account with phone as password
router.post(
  '/owners/:id/reset-login',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const owner = await prisma.owner.findUnique({
        where: { id: req.params.id },
        include: { flat: { include: { block: { select: { societyId: true, name: true, society: { select: { name: true } } } } } } },
      });
      if (!owner) return res.status(404).json({ error: 'Owner not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && owner.flat.block.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      if (!owner.email || !owner.phone) {
        return res.status(400).json({ error: 'Owner must have both email and phone to reset login.' });
      }

      const societyId = owner.flat.block.societyId;
      const passwordHash = await bcrypt.hash(owner.phone, 12);

      let userId: string | null = owner.userId;

      if (userId) {
        // Reactivate existing linked user and reset password
        await prisma.user.update({
          where: { id: userId },
          data: {
            passwordHash,
            isActive: true,
            mustChangePassword: true,
            email: owner.email,
            name: owner.name,
            phone: owner.phone,
            societyId,
            activeSocietyId: societyId,
          },
        });
      } else {
        // Find any existing active user with this email or create a new one
        const existingUser = await findUserByEmailInsensitive(prisma, owner.email!, {
          id: true, role: true, societyId: true, activeSocietyId: true,
        });

        if (existingUser) {
          userId = existingUser.id;
          await prisma.user.update({
            where: { id: userId as string },
            data: { passwordHash, isActive: true, mustChangePassword: true },
          });
        } else {
          const newUser = await prisma.user.create({
            data: {
              email: owner.email,
              passwordHash,
              name: owner.name,
              phone: owner.phone,
              role: 'OWNER',
              societyId,
              activeSocietyId: societyId,
              mustChangePassword: true,
            },
          });
          userId = newUser.id;
        }

        await prisma.owner.update({ where: { id: owner.id }, data: { userId } });
      }

      // Ensure society membership exists
      const membership = await prisma.userSocietyMembership.findUnique({
        where: { userId_societyId: { userId: userId as string, societyId } },
      });
      if (!membership) {
        await prisma.userSocietyMembership.create({
          data: { userId: userId as string, societyId, role: 'OWNER' },
        });
      }

      sendResidentOnboardingEmail(owner.email, {
        userName: owner.name,
        societyName: owner.flat.block.society?.name || 'your society',
        flatNumber: owner.flat.flatNumber,
        blockName: owner.flat.block.name || null,
        relation: 'OWNER',
        loginEmail: owner.email,
        phoneNumber: owner.phone,
        accountCreated: true,
        mode: 'reset',
      }).catch((emailError: any) => {
        logger.error('Resident onboarding email failed for owner reset login', {
          ownerId: owner.id,
          email: owner.email,
          error: emailError.message,
        });
      });

      return res.json({ message: 'Login reset. Owner can now log in with their phone number as password.' });
    } catch (error: any) {
      logger.error('Owner login reset failed', { ownerId: req.params.id, error: error.message });
      return res.status(500).json({ error: 'Failed to reset owner login' });
    }
  },
);

// ── TENANT CRUD ─────────────────────────────────────────
router.post(
  '/tenants',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  upload.single('agreementDocument'),
  parseJsonBodyField,
  [
    body('name').trim().notEmpty().withMessage('Tenant name is required'),
    body('phone').trim().customSanitizer(normalizeIndianMobileNumber).matches(INDIAN_MOBILE_REGEX).withMessage('Phone must be a valid 10-digit Indian mobile number'),
    body('email').optional({ values: 'falsy' }).trim().isEmail().withMessage('Invalid email address'),
    body('approvalComment').optional({ values: 'falsy' }).trim().isLength({ max: 500 }).withMessage('Approval comment is too long'),
    body('vehicles').optional().isArray({ max: 10 }).withMessage('Vehicles must be an array'),
    body('vehicles.*.type').optional().isIn(VEHICLE_TYPES).withMessage('Invalid vehicle type'),
    body('vehicles.*.registrationNumber').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Vehicle registration number is too long'),
    body('carNumber').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Car number is too long'),
    body('twoWheelerNumber').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Two wheeler number is too long'),
    body('flatId').isUUID(),
    body('leaseStart').isISO8601(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Agreement document is required' });

      const vehicles = req.body.vehicles !== undefined
        ? sanitizeResidentVehicles(req.body.vehicles)
        : getResidentVehiclesFromLegacyFields(req.body);
      const legacyVehicleFields = buildLegacyVehicleFields(vehicles);
      const agreementDocumentUrl = getFileUrl(req.file);

      // SECURITY: Verify flat belongs to admin's society
      const flat = await prisma.flat.findUnique({
        where: { id: req.body.flatId },
        include: { block: { select: { societyId: true } }, tenant: true },
      });
      if (!flat) return res.status(404).json({ error: 'Flat not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && flat.block.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      if (flat.tenant?.isActive) {
        return res.status(409).json({ error: 'This flat already has an active tenant' });
      }

      const approvalConfig = await getApprovalConfig(flat.block.societyId, 'TENANT_REGISTRATION');
      if (approvalConfig.enabled) {
        const normalizedEmail = req.body.email ? String(req.body.email).trim().toLowerCase() : null;
        const approvalRequest = await createTenantRegistrationApproval({
          societyId: flat.block.societyId,
          requestedById: req.user!.id,
          requesterName: req.user!.email,
          requesterComment: req.body.approvalComment || null,
          flatId: req.body.flatId,
          pendingData: {
            name: req.body.name,
            phone: req.body.phone,
            email: normalizedEmail,
            altPhone: req.body.altPhone || null,
            aadharNo: req.body.aadharNo || null,
            flatId: req.body.flatId,
            agreementDocumentUrl,
            leaseStart: new Date(req.body.leaseStart).toISOString(),
            leaseEnd: req.body.leaseEnd ? new Date(req.body.leaseEnd).toISOString() : null,
            rentAmount: req.body.rentAmount ? parseFloat(req.body.rentAmount) : null,
            deposit: req.body.deposit ? parseFloat(req.body.deposit) : null,
            vehicles,
          },
        });

        return res.status(202).json({
          message: 'Tenant registration submitted for approval',
          approvalRequestId: approvalRequest.id,
          status: approvalRequest.status,
          approverRoles: approvalRequest.approverRoles,
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        // Auto-create user account if email + phone provided
        let tenantUserId: string | null = null;
        let createdNewUser = false;
        if (req.body.email && req.body.phone) {
          const normalizedEmail = String(req.body.email).trim().toLowerCase();
          const existingUser = await findUserByEmailInsensitive(tx, normalizedEmail, {
            id: true,
            role: true,
            societyId: true,
            activeSocietyId: true,
          });

          if (existingUser) {
            // If user already belongs to this society, reuse them
            const sameSocietyMembership = await tx.userSocietyMembership.findUnique({
              where: { userId_societyId: { userId: existingUser.id, societyId: flat.block.societyId } },
              select: { id: true },
            });
            if (!sameSocietyMembership) {
              await tx.userSocietyMembership.create({
                data: {
                  userId: existingUser.id,
                  societyId: flat.block.societyId,
                  role: getLinkedMembershipRole(existingUser, flat.block.societyId, 'TENANT') as any,
                },
              });
            }
            tenantUserId = existingUser.id;
          } else {
            const passwordHash = await bcrypt.hash(req.body.phone, 12);
            const newUser = await tx.user.create({
              data: {
                email: normalizedEmail,
                passwordHash,
                name: req.body.name,
                phone: req.body.phone,
                role: 'TENANT',
                societyId: flat.block.societyId,
                activeSocietyId: flat.block.societyId,
                mustChangePassword: true,
              },
            });
            await tx.userSocietyMembership.create({
              data: { userId: newUser.id, societyId: flat.block.societyId, role: 'TENANT' },
            });
            tenantUserId = newUser.id;
            createdNewUser = true;
          }
        }

        if (flat.tenant && !flat.tenant.isActive) {
          await tx.tenant.delete({ where: { id: flat.tenant.id } });
        }

        const tenant = await tx.tenant.create({
          data: {
            name: req.body.name,
            phone: req.body.phone,
            email: req.body.email ? String(req.body.email).trim().toLowerCase() : null,
            agreementDocumentUrl,
            ...legacyVehicleFields,
            altPhone: req.body.altPhone || null,
            aadharNo: req.body.aadharNo || null,
            flatId: req.body.flatId,
            leaseStart: new Date(req.body.leaseStart),
            leaseEnd: req.body.leaseEnd ? new Date(req.body.leaseEnd) : null,
            rentAmount: req.body.rentAmount ? parseFloat(req.body.rentAmount) : null,
            deposit: req.body.deposit ? parseFloat(req.body.deposit) : null,
            userId: tenantUserId,
            ...(vehicles.length ? { vehicles: { create: vehicles } } : {}),
          },
        });

        return { tenant, accountLinked: !!tenantUserId, accountCreated: createdNewUser };
      });

      if (req.body.email && req.body.phone && result.accountLinked) {
        prisma.block.findUnique({
          where: { id: flat.blockId },
          include: { society: { select: { name: true } } },
        }).then((blockRecord) => {
          return sendResidentOnboardingEmail(String(req.body.email).trim().toLowerCase(), {
            userName: req.body.name,
            societyName: blockRecord?.society?.name || 'your society',
            flatNumber: flat.flatNumber,
            blockName: blockRecord?.name || null,
            relation: 'TENANT',
            loginEmail: String(req.body.email).trim().toLowerCase(),
            phoneNumber: req.body.phone,
            accountCreated: result.accountCreated,
          });
        }).catch((emailError: any) => {
          logger.error('Resident onboarding email failed for tenant', {
            flatId: req.body.flatId,
            email: req.body.email,
            error: emailError.message,
          });
        });
      }

      return res.status(201).json({
        ...result.tenant,
        userCreated: result.accountLinked,
        loginInfo: result.accountLinked
          ? {
              email: req.body.email,
              defaultPassword: result.accountCreated ? 'Phone number is the default password' : 'Use existing password or reset it from the login screen',
            }
          : null,
      });
    } catch (error: any) {
      if (error.message === 'PENDING_APPROVAL_EXISTS') {
        return res.status(409).json({ error: 'A tenant registration approval is already pending for this flat' });
      }
      if (error.code === 'P2002') {
        return res.status(409).json({ error: 'This flat already has a tenant' });
      }
      if (error.message === 'TENANT_EMAIL_ALREADY_IN_SOCIETY') {
        return res.status(409).json({ error: 'A user with this email already exists in this society' });
      }
      return res.status(500).json({ error: 'Failed to create tenant' });
    }
  },
);

router.put(
  '/tenants/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  upload.single('agreementDocument'),
  parseJsonBodyField,
  [
    param('id').isUUID(),
    body('name').optional().trim().notEmpty().withMessage('Tenant name is required'),
    body('phone').optional().trim().customSanitizer(normalizeIndianMobileNumber).matches(INDIAN_MOBILE_REGEX).withMessage('Phone must be a valid 10-digit Indian mobile number'),
    body('email').optional({ values: 'falsy' }).trim().isEmail().withMessage('Invalid email address'),
    body('vehicles').optional().isArray({ max: 10 }).withMessage('Vehicles must be an array'),
    body('vehicles.*.type').optional().isIn(VEHICLE_TYPES).withMessage('Invalid vehicle type'),
    body('vehicles.*.registrationNumber').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Vehicle registration number is too long'),
    body('carNumber').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Car number is too long'),
    body('twoWheelerNumber').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Two wheeler number is too long'),
  ],
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

      const normalizedEmail = req.body.email ? String(req.body.email).trim().toLowerCase() : undefined;
  const hasVehicleArray = req.body.vehicles !== undefined;
  const vehicles = hasVehicleArray ? sanitizeResidentVehicles(req.body.vehicles) : [];
  const legacyVehicleFields = hasVehicleArray ? buildLegacyVehicleFields(vehicles) : null;
        const agreementDocumentUrl = req.file ? getFileUrl(req.file) : undefined;
      let userId: string | undefined;

      const emailToLookup = normalizedEmail || existing.email || undefined;
      if (emailToLookup && (normalizedEmail !== existing.email || !existing.userId)) {
        const matchedUser = await findUserByEmailInsensitive(prisma, emailToLookup, {
          id: true,
          role: true,
          societyId: true,
          activeSocietyId: true,
        });

        if (matchedUser) {
          userId = matchedUser.id;

          const membership = await prisma.userSocietyMembership.findUnique({
            where: { userId_societyId: { userId: matchedUser.id, societyId: existing.flat.block.societyId } },
          });

          if (!membership) {
            await prisma.userSocietyMembership.create({
              data: {
                userId: matchedUser.id,
                societyId: existing.flat.block.societyId,
                role: getLinkedMembershipRole(matchedUser, existing.flat.block.societyId, 'TENANT') as any,
              },
            });
          }
        }
      }

      const tenant = await prisma.tenant.update({
        where: { id: req.params.id },
        data: {
          name: req.body.name,
          phone: req.body.phone,
          email: normalizedEmail,
          agreementDocumentUrl,
          carNumber: legacyVehicleFields
            ? legacyVehicleFields.carNumber
            : req.body.carNumber !== undefined
              ? normalizeRegistrationValue(req.body.carNumber)
              : undefined,
          twoWheelerNumber: legacyVehicleFields
            ? legacyVehicleFields.twoWheelerNumber
            : req.body.twoWheelerNumber !== undefined
              ? normalizeRegistrationValue(req.body.twoWheelerNumber)
              : undefined,
          altPhone: req.body.altPhone,
          aadharNo: req.body.aadharNo,
          leaseStart: req.body.leaseStart ? new Date(req.body.leaseStart) : undefined,
          leaseEnd: req.body.leaseEnd ? new Date(req.body.leaseEnd) : undefined,
          rentAmount: req.body.rentAmount !== undefined ? parseFloat(req.body.rentAmount) : undefined,
          deposit: req.body.deposit !== undefined ? parseFloat(req.body.deposit) : undefined,
          isActive: req.body.isActive,
          ...(userId !== undefined ? { userId } : {}),
          ...(hasVehicleArray
            ? {
                vehicles: {
                  deleteMany: {},
                  ...(vehicles.length ? { create: vehicles } : {}),
                },
              }
            : {}),
        },
      });
      return res.json(tenant);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update tenant' });
    }
  },
);

router.delete(
  '/tenants/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [
    param('id').isUUID(),
    body('reason').trim().notEmpty().withMessage('Reason is required'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const existing = await prisma.tenant.findUnique({
        where: { id: req.params.id },
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
          flat: { include: { block: { select: { societyId: true, name: true } }, owner: { select: { id: true, name: true } } } },
        },
      });

      if (!existing) return res.status(404).json({ error: 'Tenant not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && existing.flat.block.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      if (!existing.isActive) {
        return res.status(409).json({ error: 'Tenant is already deactivated' });
      }

      const outstandingDue = await getOutstandingFlatDue(existing.flatId);
      if (outstandingDue > 0) {
        return res.status(409).json({ error: `Cannot deactivate resident while flat has outstanding dues of Rs. ${outstandingDue.toFixed(2)}.` });
      }

      const societyId = existing.flat.block.societyId;
      const reason = String(req.body.reason || '').trim();
      const society = await prisma.society.findUnique({ where: { id: societyId }, select: { name: true } });

      await runMemberRemoval({
        societyId,
        societyName: society?.name || 'your society',
        targetUserId: existing.userId,
        targetRole: 'TENANT',
        removedByUserId: req.user!.id,
        removedByRole: req.user!.role as any,
        reason,
        source: 'FLAT_MANAGEMENT',
        recipientEmail: null,
        recipientName: existing.user?.name || existing.name,
        tenantId: existing.id,
        flatId: existing.flatId,
        snapshot: {
          name: existing.name,
          email: existing.email,
          phone: existing.phone,
          flatNumber: existing.flat.flatNumber,
          blockName: existing.flat.block.name,
          ownerName: existing.flat.owner?.name || null,
        },
        removeData: async (tx) => {
          await tx.tenant.update({
            where: { id: existing.id },
            data: {
              isActive: false,
              deactivatedAt: new Date(),
              deactivationReason: reason,
            },
          });

          const hasActiveOwner = await tx.owner.findFirst({
            where: { flatId: existing.flatId, isActive: true },
            select: { id: true },
          });

          await tx.flat.update({
            where: { id: existing.flatId },
            data: { isOccupied: !!hasActiveOwner },
          });
        },
        deleteMembership: async (tx) => {
          return shouldDeleteResidentMembership(tx, {
            userId: existing.userId,
            societyId,
            userRole: existing.user?.role,
            excludeTenantId: existing.id,
          });
        },
      });

      logger.info('Admin removed tenant', {
        removedBy: req.user!.id,
        tenantId: existing.id,
        societyId,
      });

      return res.json({ message: 'Tenant deactivated successfully' });
    } catch (error: any) {
      logger.error('Failed to deactivate tenant', { error: error.message, tenantId: req.params.id });
      return res.status(500).json({ error: 'Failed to deactivate tenant' });
    }
  },
);

// ── OWNER: ADD TENANT TO OWN FLAT ───────────────────────
router.post(
  '/my-flat/tenant',
  upload.single('agreementDocument'),
  [
    body('name').trim().notEmpty().withMessage('Tenant name is required'),
    body('phone').trim().customSanitizer(normalizeIndianMobileNumber).matches(INDIAN_MOBILE_REGEX).withMessage('Phone must be a valid 10-digit Indian mobile number'),
    body('email').optional({ values: 'falsy' }).trim().isEmail().withMessage('Invalid email'),
    body('approvalComment').optional({ values: 'falsy' }).trim().isLength({ max: 500 }).withMessage('Approval comment is too long'),
    body('leaseStart').optional({ values: 'falsy' }).isISO8601(),
    body('leaseEnd').optional({ values: 'falsy' }).isISO8601(),
    body('rentAmount').optional({ values: 'falsy' }).isFloat({ min: 0 }),
    body('deposit').optional({ values: 'falsy' }).isFloat({ min: 0 }),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Agreement document is required' });

      const userId = req.user!.id;
      const societyId = req.user!.societyId;
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });
      const agreementDocumentUrl = getFileUrl(req.file);

      // Find flat owned by this user in their active society
      const owner = await prisma.owner.findFirst({
        where: { userId, flat: { block: { societyId } } },
        include: { flat: { include: { tenant: true, block: { select: { societyId: true } } } } },
      });
      if (!owner) return res.status(403).json({ error: 'You are not an owner in this society' });
      if (owner.flat.tenant && owner.flat.tenant.isActive) {
        return res.status(409).json({ error: 'This flat already has an active tenant. Remove the existing tenant first.' });
      }

      const approvalConfig = await getApprovalConfig(societyId, 'TENANT_REGISTRATION');
      if (approvalConfig.enabled) {
        const normalizedEmail = req.body.email ? String(req.body.email).trim().toLowerCase() : null;
        const approvalRequest = await createTenantRegistrationApproval({
          societyId,
          requestedById: req.user!.id,
          requesterName: req.user!.email,
          requesterComment: req.body.approvalComment || null,
          flatId: owner.flat.id,
          pendingData: {
            name: req.body.name,
            phone: req.body.phone,
            email: normalizedEmail,
            altPhone: null,
            aadharNo: null,
            flatId: owner.flat.id,
            agreementDocumentUrl,
            leaseStart: req.body.leaseStart ? new Date(req.body.leaseStart).toISOString() : new Date().toISOString(),
            leaseEnd: req.body.leaseEnd ? new Date(req.body.leaseEnd).toISOString() : null,
            rentAmount: req.body.rentAmount ? parseFloat(req.body.rentAmount) : null,
            deposit: req.body.deposit ? parseFloat(req.body.deposit) : null,
            vehicles: [],
          },
        });

        return res.status(202).json({
          message: 'Tenant registration submitted for approval',
          approvalRequestId: approvalRequest.id,
          status: approvalRequest.status,
          approverRoles: approvalRequest.approverRoles,
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        // Auto-create user account if email + phone provided
        let tenantUserId: string | null = null;
        if (req.body.email && req.body.phone) {
          const normalizedEmail = String(req.body.email).trim().toLowerCase();
          const existingUser = await findUserByEmailInsensitive(tx, normalizedEmail, { id: true, role: true, societyId: true, activeSocietyId: true });

          if (existingUser) {
            // If user already belongs to this society, reuse them
            const sameSocietyMembership = await tx.userSocietyMembership.findUnique({
              where: { userId_societyId: { userId: existingUser.id, societyId } },
              select: { id: true },
            });
            if (!sameSocietyMembership) {
              const membershipRole = getLinkedMembershipRole(existingUser, societyId, 'TENANT');
              await tx.userSocietyMembership.create({
                data: { userId: existingUser.id, societyId, role: membershipRole as any },
              });
            }
            tenantUserId = existingUser.id;
          } else {
            const passwordHash = await bcrypt.hash(req.body.phone, 12);
            const newUser = await tx.user.create({
              data: {
                email: normalizedEmail,
                passwordHash,
                name: req.body.name,
                phone: req.body.phone,
                role: 'TENANT',
                societyId,
                activeSocietyId: societyId,
                mustChangePassword: true,
              },
            });
            await tx.userSocietyMembership.create({
              data: { userId: newUser.id, societyId, role: 'TENANT' },
            });
            tenantUserId = newUser.id;
          }
        }

        // If there's an inactive tenant record for this flat, remove it first
        if (owner.flat.tenant && !owner.flat.tenant.isActive) {
          await tx.tenant.delete({ where: { id: owner.flat.tenant.id } });
        }

        const tenant = await tx.tenant.create({
          data: {
            name: req.body.name,
            phone: req.body.phone,
            email: req.body.email ? String(req.body.email).trim().toLowerCase() : null,
            agreementDocumentUrl,
            flatId: owner.flat.id,
            leaseStart: req.body.leaseStart ? new Date(req.body.leaseStart) : new Date(),
            leaseEnd: req.body.leaseEnd ? new Date(req.body.leaseEnd) : null,
            rentAmount: req.body.rentAmount ? parseFloat(req.body.rentAmount) : null,
            deposit: req.body.deposit ? parseFloat(req.body.deposit) : null,
            userId: tenantUserId,
          },
        });

        return { tenant, userCreated: !!tenantUserId };
      });

      logger.info('Owner added tenant', {
        ownerId: owner.id,
        tenantId: result.tenant.id,
        flatId: owner.flat.id,
        userCreated: result.userCreated,
      });

      return res.status(201).json({
        ...result.tenant,
        userCreated: result.userCreated,
        loginInfo: result.userCreated
          ? { email: req.body.email, defaultPassword: 'Phone number is the default password' }
          : null,
      });
    } catch (error: any) {
      if (error.message === 'PENDING_APPROVAL_EXISTS') {
        return res.status(409).json({ error: 'A tenant registration approval is already pending for this flat' });
      }
      if (error.code === 'P2002') {
        return res.status(409).json({ error: 'This flat already has a tenant' });
      }
      if (error.message === 'USER_EMAIL_ALREADY_EXISTS_IN_SOCIETY') {
        return res.status(409).json({ error: 'A user with this email already exists in this society' });
      }
      logger.error('Failed to add tenant', { error: error.message });
      return res.status(500).json({ error: 'Failed to add tenant' });
    }
  },
);

// ── OWNER: UPDATE OWN FLAT'S TENANT ─────────────────────
router.patch(
  '/my-flat/resident/photo',
  upload.single('photo'),
  [
    body('relation').optional().isIn(['OWNER', 'TENANT']).withMessage('Invalid resident relation'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Profile photo is required' });
      }

      const userId = req.user!.id;
      const societyId = req.user!.societyId;
      const requestedRelation = req.body.relation as 'OWNER' | 'TENANT' | undefined;
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const photoUrl = getFileUrl(req.file);

      const owner = requestedRelation === 'TENANT'
        ? null
        : await prisma.owner.findFirst({
            where: { userId, flat: { block: { societyId } } },
            select: { id: true, photoUrl: true },
          });

      if (owner) {
        const resident = await prisma.owner.update({
          where: { id: owner.id },
          data: { photoUrl },
        });

        return res.json({ relation: 'OWNER', resident });
      }

      if (requestedRelation === 'OWNER') {
        return res.status(404).json({ error: 'No owner record linked to your account' });
      }

      const tenant = await prisma.tenant.findFirst({
        where: { userId, flat: { block: { societyId } }, isActive: true },
        select: { id: true, photoUrl: true },
      });

      if (!tenant) {
        return res.status(404).json({ error: 'No resident record linked to your account' });
      }

      const resident = await prisma.tenant.update({
        where: { id: tenant.id },
        data: { photoUrl },
      });

      return res.json({ relation: 'TENANT', resident });
    } catch (error: any) {
      logger.error('Failed to update resident photo', { error: error.message });
      return res.status(500).json({ error: 'Failed to update resident photo' });
    }
  },
);

router.put(
  '/my-flat/resident',
  [
    body('relation').optional().isIn(['OWNER', 'TENANT']).withMessage('Invalid resident relation'),
    body('phone').optional().trim().customSanitizer(normalizeIndianMobileNumber).matches(INDIAN_MOBILE_REGEX).withMessage('Phone must be a valid 10-digit Indian mobile number'),
    body('occupation').optional({ values: 'falsy' }).trim().isLength({ max: 120 }).withMessage('Occupation is too long'),
    body('householdAdults').optional({ values: 'null' }).isInt({ min: 0, max: 20 }).withMessage('Adults count must be between 0 and 20'),
    body('householdKids').optional({ values: 'null' }).isInt({ min: 0, max: 20 }).withMessage('Kids count must be between 0 and 20'),
    body('householdSeniors').optional({ values: 'null' }).isInt({ min: 0, max: 20 }).withMessage('Senior citizens count must be between 0 and 20'),
    body('pets').optional({ values: 'falsy' }).trim().isLength({ max: 200 }).withMessage('Pets details are too long'),
    body('carNumber').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Car number is too long'),
    body('twoWheelerNumber').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Two wheeler number is too long'),
    body('vehicles').optional().isArray({ max: 10 }).withMessage('Vehicles must be an array'),
    body('vehicles.*.type').optional().isIn(['TWO_WHEELER', 'THREE_WHEELER', 'FOUR_WHEELER']).withMessage('Invalid vehicle type'),
    body('vehicles.*.registrationNumber').optional().trim().isLength({ min: 1, max: 30 }).withMessage('Vehicle registration number is required'),
    body('approvalComment').optional({ values: 'falsy' }).trim().isLength({ max: 500 }).withMessage('Approval comment is too long'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const societyId = req.user!.societyId;
      const requestedRelation = req.body.relation as 'OWNER' | 'TENANT' | undefined;
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const normalizedVehicles = Array.isArray(req.body.vehicles)
        ? req.body.vehicles
            .map((vehicle: { type: 'TWO_WHEELER' | 'THREE_WHEELER' | 'FOUR_WHEELER'; registrationNumber: string }) => ({
              type: vehicle.type,
              registrationNumber: normalizeRegistrationValue(vehicle.registrationNumber) || '',
            }))
            .filter((vehicle: { registrationNumber: string }) => vehicle.registrationNumber)
        : undefined;
      const legacyVehicles = normalizedVehicles ? deriveLegacyVehicleNumbers(normalizedVehicles) : null;

      const owner = requestedRelation === 'TENANT'
        ? null
        : await prisma.owner.findFirst({
            where: { userId, flat: { block: { societyId } } },
            select: { id: true, userId: true },
          });

      if (owner) {
        const resident = await prisma.$transaction(async (tx) => {
          const updatedOwner = await tx.owner.update({
            where: { id: owner.id },
            data: {
              phone: req.body.phone,
              occupation: req.body.occupation !== undefined ? normalizeResidentTextValue(req.body.occupation) : undefined,
              householdAdults: normalizeOptionalResidentCount(req.body.householdAdults),
              householdKids: normalizeOptionalResidentCount(req.body.householdKids),
              householdSeniors: normalizeOptionalResidentCount(req.body.householdSeniors),
              pets: req.body.pets !== undefined ? normalizeResidentTextValue(req.body.pets) : undefined,
              carNumber: normalizedVehicles ? legacyVehicles?.carNumber : (req.body.carNumber !== undefined ? normalizeRegistrationValue(req.body.carNumber) : undefined),
              twoWheelerNumber: normalizedVehicles ? legacyVehicles?.twoWheelerNumber : (req.body.twoWheelerNumber !== undefined ? normalizeRegistrationValue(req.body.twoWheelerNumber) : undefined),
            },
          });

          if (normalizedVehicles) {
            await tx.residentVehicle.deleteMany({ where: { ownerId: owner.id } });
            if (normalizedVehicles.length > 0) {
              await tx.residentVehicle.createMany({
                data: normalizedVehicles.map((vehicle: { type: 'TWO_WHEELER' | 'THREE_WHEELER' | 'FOUR_WHEELER'; registrationNumber: string }) => ({
                  ownerId: owner.id,
                  type: vehicle.type,
                  registrationNumber: vehicle.registrationNumber,
                })),
              });
            }
          }

          if (owner.userId && req.body.phone !== undefined) {
            await tx.user.update({
              where: { id: owner.userId },
              data: { phone: req.body.phone },
            });
          }

          return updatedOwner;
        });

        return res.json({ relation: 'OWNER', resident });
      }

      if (req.body.phone !== undefined) {
        return res.status(403).json({ error: 'Only owners can update mobile number' });
      }

      const tenant = await prisma.tenant.findFirst({
        where: { userId, flat: { block: { societyId } }, isActive: true },
        select: { id: true, flatId: true },
      });

      if (requestedRelation === 'OWNER') {
        return res.status(404).json({ error: 'No owner record linked to your account' });
      }

      if (!tenant) return res.status(404).json({ error: 'No resident record linked to your account' });

      const tenantApprovalConfig = await getApprovalConfig(societyId, 'TENANT_PROFILE_CHANGE');
      if (tenantApprovalConfig.enabled) {
        const approvalRequest = await createTenantProfileChangeApproval({
          societyId,
          requestedById: userId,
          requesterName: req.user!.email,
          tenantId: tenant.id,
          flatId: tenant.flatId,
          requesterComment: req.body.approvalComment || null,
          pendingData: {
            occupation: req.body.occupation !== undefined ? (normalizeResidentTextValue(req.body.occupation) ?? null) : null,
            householdAdults: normalizeOptionalResidentCount(req.body.householdAdults) ?? null,
            householdKids: normalizeOptionalResidentCount(req.body.householdKids) ?? null,
            householdSeniors: normalizeOptionalResidentCount(req.body.householdSeniors) ?? null,
            pets: req.body.pets !== undefined ? (normalizeResidentTextValue(req.body.pets) ?? null) : null,
            vehicles: normalizedVehicles || [],
          },
        });

        return res.status(202).json({
          message: 'Resident profile change submitted for approval',
          approvalRequestId: approvalRequest.id,
          status: approvalRequest.status,
          approverRoles: approvalRequest.approverRoles,
        });
      }

      const resident = await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          occupation: req.body.occupation !== undefined ? normalizeResidentTextValue(req.body.occupation) : undefined,
          householdAdults: normalizeOptionalResidentCount(req.body.householdAdults),
          householdKids: normalizeOptionalResidentCount(req.body.householdKids),
          householdSeniors: normalizeOptionalResidentCount(req.body.householdSeniors),
          pets: req.body.pets !== undefined ? normalizeResidentTextValue(req.body.pets) : undefined,
          carNumber: normalizedVehicles ? legacyVehicles?.carNumber : (req.body.carNumber !== undefined ? normalizeRegistrationValue(req.body.carNumber) : undefined),
          twoWheelerNumber: normalizedVehicles ? legacyVehicles?.twoWheelerNumber : (req.body.twoWheelerNumber !== undefined ? normalizeRegistrationValue(req.body.twoWheelerNumber) : undefined),
        },
      });

      if (normalizedVehicles) {
        await prisma.residentVehicle.deleteMany({ where: { tenantId: tenant.id } });
        if (normalizedVehicles.length > 0) {
          await prisma.residentVehicle.createMany({
            data: normalizedVehicles.map((vehicle: { type: 'TWO_WHEELER' | 'THREE_WHEELER' | 'FOUR_WHEELER'; registrationNumber: string }) => ({
              tenantId: tenant.id,
              type: vehicle.type,
              registrationNumber: vehicle.registrationNumber,
            })),
          });
        }
      }

      return res.json({ relation: 'TENANT', resident });
    } catch (error: any) {
      if (error.message === 'PENDING_APPROVAL_EXISTS') {
        return res.status(409).json({ error: 'A tenant profile change approval is already pending' });
      }
      return res.status(500).json({ error: 'Failed to update resident details' });
    }
  },
);

router.put(
  '/my-flat/tenant',
  upload.single('agreementDocument'),
  [
    body('name').optional().trim().notEmpty(),
    body('phone').optional().trim().customSanitizer(normalizeIndianMobileNumber).matches(INDIAN_MOBILE_REGEX).withMessage('Phone must be a valid 10-digit Indian mobile number'),
    body('email').optional({ values: 'falsy' }).trim().isEmail().withMessage('Invalid email'),
    body('carNumber').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Car number is too long'),
    body('twoWheelerNumber').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Two wheeler number is too long'),
    body('leaseStart').optional({ values: 'falsy' }).isISO8601(),
    body('leaseEnd').optional({ values: 'falsy' }).isISO8601(),
    body('rentAmount').optional({ values: 'falsy' }).isFloat({ min: 0 }),
    body('deposit').optional({ values: 'falsy' }).isFloat({ min: 0 }),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const societyId = req.user!.societyId;
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const owner = await prisma.owner.findFirst({
        where: { userId, flat: { block: { societyId } } },
        include: { flat: { include: { tenant: true } } },
      });
      if (!owner) return res.status(403).json({ error: 'You are not an owner in this society' });
      if (!owner.flat.tenant) return res.status(404).json({ error: 'No tenant found for this flat' });

      const normalizedEmail = req.body.email ? String(req.body.email).trim().toLowerCase() : undefined;
      const agreementDocumentUrl = req.file ? getFileUrl(req.file) : undefined;

      const tenant = await prisma.tenant.update({
        where: { id: owner.flat.tenant.id },
        data: {
          name: req.body.name,
          phone: req.body.phone,
          email: normalizedEmail,
          agreementDocumentUrl,
          carNumber: req.body.carNumber !== undefined ? normalizeRegistrationValue(req.body.carNumber) : undefined,
          twoWheelerNumber: req.body.twoWheelerNumber !== undefined ? normalizeRegistrationValue(req.body.twoWheelerNumber) : undefined,
          leaseStart: req.body.leaseStart ? new Date(req.body.leaseStart) : undefined,
          leaseEnd: req.body.leaseEnd ? new Date(req.body.leaseEnd) : undefined,
          rentAmount: req.body.rentAmount !== undefined ? parseFloat(req.body.rentAmount) : undefined,
          deposit: req.body.deposit !== undefined ? parseFloat(req.body.deposit) : undefined,
        },
      });

      return res.json(tenant);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update tenant' });
    }
  },
);

// ── OWNER: REMOVE OWN FLAT'S TENANT ─────────────────────
router.delete(
  '/my-flat/tenant',
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const societyId = req.user!.societyId;
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const owner = await prisma.owner.findFirst({
        where: { userId, flat: { block: { societyId } } },
        include: { flat: { include: { tenant: true } } },
      });
      if (!owner) return res.status(403).json({ error: 'You are not an owner in this society' });
      if (!owner.flat.tenant) return res.status(404).json({ error: 'No tenant found for this flat' });

      await prisma.tenant.update({
        where: { id: owner.flat.tenant.id },
        data: { isActive: false },
      });

      logger.info('Owner removed tenant', {
        ownerId: owner.id,
        tenantId: owner.flat.tenant.id,
        flatId: owner.flat.id,
      });

      return res.json({ message: 'Tenant removed successfully' });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to remove tenant' });
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
      
      const society = await prisma.society.findUnique({ where: { id: societyId }});
      if (!society) return res.status(404).json({ error: 'Society not found' });
      
      const limitStatus = await getFlatLimitStatus(societyId);
      let currentFlatCount = limitStatus.flatCount;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2; // Excel row (1-indexed header + data)

        if ((currentFlatCount + createdCount) >= limitStatus.includedFlatCount) {
          results.push({ row: rowNum, flatNumber: '(skipped)', status: 'error', error: limitStatus.message });
          errorCount++;
          continue;
        }

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
                  // If user already belongs to this society, reuse them
                  const sameSocietyMembership = await tx.userSocietyMembership.findUnique({
                    where: { userId_societyId: { userId: existingUser.id, societyId } },
                    select: { id: true },
                  });
                  if (!sameSocietyMembership) {
                    await tx.userSocietyMembership.create({
                      data: {
                        userId: existingUser.id,
                        societyId,
                        role: 'OWNER',
                      },
                    });
                  }
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
