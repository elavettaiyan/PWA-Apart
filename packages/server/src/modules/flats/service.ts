import { NextFunction, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { AuthRequest } from '../../middleware/auth';
import { computeTrialStatus } from '../premium/routes';

export const FLAT_FEATURES = ['BALCONY', 'CENTRAL_AC'] as const;
export const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
export const PARKING_TYPES = ['NONE', 'OPEN', 'COVERED'] as const;
export const VEHICLE_TYPES = ['TWO_WHEELER', 'THREE_WHEELER', 'FOUR_WHEELER'] as const;

const FREE_TIER_FLAT_LIMIT = 5;

export const residentVehicleSelect = {
  id: true,
  type: true,
  registrationNumber: true,
} as const;

export type NormalizedResidentVehicle = {
  type: (typeof VEHICLE_TYPES)[number];
  registrationNumber: string;
};

export function sanitizeFlatFeatures(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((value) => String(value || '').trim().toUpperCase())
        .filter((value): value is (typeof FLAT_FEATURES)[number] => FLAT_FEATURES.includes(value as (typeof FLAT_FEATURES)[number])),
    ),
  );
}

export function normalizeIndianMobileNumber(value: string): string {
  const digitsOnly = String(value || '').replace(/\D/g, '');

  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    return digitsOnly.slice(2);
  }

  if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
    return digitsOnly.slice(1);
  }

  return digitsOnly;
}

export function normalizeRegistrationValue(value: unknown) {
  const trimmed = String(value ?? '').trim().toUpperCase();
  return trimmed ? trimmed : null;
}

export function parseJsonBodyField(req: AuthRequest, res: Response, next: NextFunction) {
  if (typeof req.body.vehicles === 'string') {
    try {
      req.body.vehicles = JSON.parse(req.body.vehicles);
    } catch {
      return res.status(400).json({ error: 'Vehicles must be a valid JSON array' });
    }
  }

  next();
}

export function sanitizeResidentVehicles(input: unknown): NormalizedResidentVehicle[] {
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

export function getResidentVehiclesFromLegacyFields(input: { carNumber?: unknown; twoWheelerNumber?: unknown }): NormalizedResidentVehicle[] {
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

export function buildLegacyVehicleFields(vehicles: NormalizedResidentVehicle[]) {
  return {
    carNumber: vehicles.find((vehicle) => vehicle.type === 'FOUR_WHEELER')?.registrationNumber ?? null,
    twoWheelerNumber: vehicles.find((vehicle) => vehicle.type === 'TWO_WHEELER')?.registrationNumber ?? null,
  };
}

export async function findUserByEmailInsensitive(tx: any, email: string, select?: Record<string, boolean>) {
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

export function getLinkedMembershipRole(
  existingUser: { role: string; societyId?: string | null; activeSocietyId?: string | null },
  societyId: string,
  fallbackRole: 'OWNER' | 'TENANT',
) {
  if (existingUser.societyId === societyId || existingUser.activeSocietyId === societyId) {
    return existingUser.role;
  }

  return fallbackRole;
}

export function getRequestSocietyId(req: AuthRequest) {
  return req.user?.activeSocietyId || req.user?.societyId || null;
}

export async function findActiveOwnerMappingForUser(userId: string, societyId: string, excludeFlatId?: string) {
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

export function buildMyFlatInclude(year?: number): Prisma.FlatInclude {
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

export function normalizeResidentTextValue(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

export function normalizeOptionalResidentCount(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function deriveLegacyVehicleNumbers(vehicles: Array<{ type: 'TWO_WHEELER' | 'THREE_WHEELER' | 'FOUR_WHEELER'; registrationNumber: string }>) {
  const firstFourWheeler = vehicles.find((vehicle) => vehicle.type === 'FOUR_WHEELER')?.registrationNumber || null;
  const firstTwoWheeler = vehicles.find((vehicle) => vehicle.type === 'TWO_WHEELER')?.registrationNumber || null;

  return {
    carNumber: firstFourWheeler,
    twoWheelerNumber: firstTwoWheeler,
  };
}

export async function getFlatLimitStatus(societyId: string) {
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

export async function getOutstandingFlatDue(flatId: string) {
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

export async function shouldDeleteResidentMembership(
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