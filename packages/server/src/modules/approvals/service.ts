import bcrypt from 'bcryptjs';
import { ApprovalActionType, ApprovalStatus, Prisma, Role } from '@prisma/client';
import prisma from '../../config/database';
import logger from '../../config/logger';
import { sendResidentOnboardingEmail } from '../../config/email';
import { COMMUNITY_READ_ITEM_TYPES, getCommunityItemReadStateMap } from '../communityReadState/service';
import { notifyApprovalRequestCreated, notifyApprovalRequestResolved } from '../notifications/service';

const DEFAULT_APPROVER_ROLES: Role[] = ['ADMIN', 'SECRETARY'];
const ALLOWED_APPROVER_ROLES: Role[] = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER', 'OWNER'];

type TenantRegistrationVehicle = {
  type: 'TWO_WHEELER' | 'THREE_WHEELER' | 'FOUR_WHEELER';
  registrationNumber: string;
};

type TenantRegistrationPendingData = {
  name: string;
  phone: string;
  email: string | null;
  altPhone: string | null;
  aadharNo: string | null;
  flatId: string;
  leaseStart: string;
  leaseEnd: string | null;
  rentAmount: number | null;
  deposit: number | null;
  vehicles: TenantRegistrationVehicle[];
};

type TenantProfileChangePendingData = {
  occupation: string | null;
  householdAdults: number | null;
  householdKids: number | null;
  householdSeniors: number | null;
  pets: string | null;
  vehicles: TenantRegistrationVehicle[];
};

function parseApproverRoles(rawValue?: string | null): Role[] {
  if (!rawValue) {
    return [...DEFAULT_APPROVER_ROLES];
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [...DEFAULT_APPROVER_ROLES];
    }

    const roles = [...new Set(parsed.filter((role): role is Role => ALLOWED_APPROVER_ROLES.includes(role as Role)))];
    return roles.length > 0 ? roles : [...DEFAULT_APPROVER_ROLES];
  } catch {
    return [...DEFAULT_APPROVER_ROLES];
  }
}

function normalizeApproverRoles(roles?: string[]) {
  const normalized = [...new Set((roles || []).filter((role): role is Role => ALLOWED_APPROVER_ROLES.includes(role as Role)))];
  return normalized.length > 0 ? normalized : [...DEFAULT_APPROVER_ROLES];
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

async function resolveApprovalApproverUserIds(args: {
  societyId: string;
  flatId?: string | null;
  approverRoles: Role[];
  requesterUserId: string;
}) {
  const directRoles = args.approverRoles.filter((role) => role !== 'OWNER' && role !== 'TENANT');

  const [memberships, flat] = await Promise.all([
    directRoles.length > 0
      ? prisma.userSocietyMembership.findMany({
          where: {
            societyId: args.societyId,
            role: { in: directRoles },
            user: { isActive: true },
          },
          select: { userId: true },
        })
      : Promise.resolve([]),
    args.flatId && (args.approverRoles.includes('OWNER') || args.approverRoles.includes('TENANT'))
      ? prisma.flat.findUnique({
          where: { id: args.flatId },
          select: {
            owner: { select: { userId: true, isActive: true } },
            tenant: { select: { userId: true, isActive: true } },
          },
        })
      : Promise.resolve(null),
  ]);

  const approverUserIds = new Set<string>();

  for (const membership of memberships) {
    if (membership.userId !== args.requesterUserId) {
      approverUserIds.add(membership.userId);
    }
  }

  if (args.approverRoles.includes('OWNER') && flat?.owner?.isActive !== false && flat?.owner?.userId && flat.owner.userId !== args.requesterUserId) {
    approverUserIds.add(flat.owner.userId);
  }

  if (args.approverRoles.includes('TENANT') && flat?.tenant?.isActive && flat?.tenant?.userId && flat.tenant.userId !== args.requesterUserId) {
    approverUserIds.add(flat.tenant.userId);
  }

  return [...approverUserIds];
}

async function findUserByEmailInsensitive(tx: Prisma.TransactionClient, email: string) {
  const normalizedEmail = String(email || '').trim().toLowerCase();

  return tx.user.findFirst({
    where: {
      email: {
        equals: normalizedEmail,
        mode: 'insensitive',
      },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      role: true,
      societyId: true,
      activeSocietyId: true,
    },
  });
}

function getFlatLabel(flat: { flatNumber: string; block?: { name: string | null } | null }) {
  return flat.block?.name ? `${flat.block.name} - ${flat.flatNumber}` : flat.flatNumber;
}

function parseTenantRegistrationPendingData(value: Prisma.JsonValue): TenantRegistrationPendingData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_PENDING_DATA');
  }

  const data = value as Record<string, unknown>;
  const name = String(data.name || '').trim();
  const phone = String(data.phone || '').trim();
  const flatId = String(data.flatId || '').trim();
  const leaseStart = String(data.leaseStart || '').trim();

  if (!name || !phone || !flatId || !leaseStart) {
    throw new Error('INVALID_PENDING_DATA');
  }

  const vehicles = Array.isArray(data.vehicles)
    ? data.vehicles
        .map((vehicle) => ({
          type: String((vehicle as any)?.type || '').trim().toUpperCase(),
          registrationNumber: String((vehicle as any)?.registrationNumber || '').trim().toUpperCase(),
        }))
        .filter((vehicle): vehicle is TenantRegistrationVehicle => (
          ['TWO_WHEELER', 'THREE_WHEELER', 'FOUR_WHEELER'].includes(vehicle.type)
          && vehicle.registrationNumber.length > 0
        ))
    : [];

  return {
    name,
    phone,
    email: data.email ? String(data.email).trim().toLowerCase() : null,
    altPhone: data.altPhone ? String(data.altPhone).trim() : null,
    aadharNo: data.aadharNo ? String(data.aadharNo).trim() : null,
    flatId,
    leaseStart,
    leaseEnd: data.leaseEnd ? String(data.leaseEnd).trim() : null,
    rentAmount: data.rentAmount === null || data.rentAmount === undefined || data.rentAmount === '' ? null : Number(data.rentAmount),
    deposit: data.deposit === null || data.deposit === undefined || data.deposit === '' ? null : Number(data.deposit),
    vehicles,
  };
}

function buildLegacyVehicleFields(vehicles: TenantRegistrationVehicle[]) {
  return {
    carNumber: vehicles.find((vehicle) => vehicle.type === 'FOUR_WHEELER')?.registrationNumber ?? null,
    twoWheelerNumber: vehicles.find((vehicle) => vehicle.type === 'TWO_WHEELER')?.registrationNumber ?? null,
  };
}

type ApprovalAccessRecord = {
  requestedById: string;
  approvedById?: string | null;
  rejectedById?: string | null;
  flat?: {
    owner?: { userId?: string | null; isActive?: boolean | null } | null;
    tenant?: { userId?: string | null; isActive?: boolean | null } | null;
  } | null;
};

function getResidentScopedApproverUserIds(record: ApprovalAccessRecord, approverRoles: Role[]) {
  const userIds = new Set<string>();

  if (approverRoles.includes('OWNER') && record.flat?.owner?.isActive !== false && record.flat?.owner?.userId) {
    userIds.add(record.flat.owner.userId);
  }

  if (approverRoles.includes('TENANT') && record.flat?.tenant?.isActive && record.flat?.tenant?.userId) {
    userIds.add(record.flat.tenant.userId);
  }

  return [...userIds];
}

function canReviewRequest(args: {
  userId: string;
  userRole: string;
  record: ApprovalAccessRecord;
  approverRoles: Role[];
}) {
  if (args.record.requestedById === args.userId || args.record.approvedById === args.userId || args.record.rejectedById === args.userId) {
    return true;
  }

  if (args.userRole === 'SUPER_ADMIN') {
    return true;
  }

  if (args.approverRoles.includes(args.userRole as Role) && args.userRole !== 'OWNER' && args.userRole !== 'TENANT') {
    return true;
  }

  if ((args.userRole === 'OWNER' || args.userRole === 'TENANT') && args.approverRoles.includes(args.userRole as Role)) {
    return getResidentScopedApproverUserIds(args.record, args.approverRoles).includes(args.userId);
  }

  return false;
}

function canActOnRequest(args: {
  actorId: string;
  actorRole: string;
  record: ApprovalAccessRecord;
  approverRoles: Role[];
}) {
  if (args.record.requestedById === args.actorId) {
    return false;
  }

  if (args.actorRole === 'SUPER_ADMIN') {
    return true;
  }

  if (args.approverRoles.includes(args.actorRole as Role) && args.actorRole !== 'OWNER' && args.actorRole !== 'TENANT') {
    return true;
  }

  if ((args.actorRole === 'OWNER' || args.actorRole === 'TENANT') && args.approverRoles.includes(args.actorRole as Role)) {
    return getResidentScopedApproverUserIds(args.record, args.approverRoles).includes(args.actorId);
  }

  return false;
}

function parseTenantProfileChangePendingData(value: Prisma.JsonValue): TenantProfileChangePendingData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_PENDING_DATA');
  }

  const data = value as Record<string, unknown>;
  const vehicles = Array.isArray(data.vehicles)
    ? data.vehicles
        .map((vehicle) => ({
          type: String((vehicle as any)?.type || '').trim().toUpperCase(),
          registrationNumber: String((vehicle as any)?.registrationNumber || '').trim().toUpperCase(),
        }))
        .filter((vehicle): vehicle is TenantRegistrationVehicle => (
          ['TWO_WHEELER', 'THREE_WHEELER', 'FOUR_WHEELER'].includes(vehicle.type)
          && vehicle.registrationNumber.length > 0
        ))
    : [];

  return {
    occupation: data.occupation == null || data.occupation === '' ? null : String(data.occupation).trim(),
    householdAdults: data.householdAdults == null || data.householdAdults === '' ? null : Number(data.householdAdults),
    householdKids: data.householdKids == null || data.householdKids === '' ? null : Number(data.householdKids),
    householdSeniors: data.householdSeniors == null || data.householdSeniors === '' ? null : Number(data.householdSeniors),
    pets: data.pets == null || data.pets === '' ? null : String(data.pets).trim(),
    vehicles,
  };
}

export async function getApprovalConfig(societyId: string, actionType: ApprovalActionType) {
  const config = await prisma.approvalConfig.findUnique({
    where: { societyId_actionType: { societyId, actionType } },
  });

  return {
    societyId,
    actionType,
    enabled: config?.enabled ?? false,
    approverRoles: parseApproverRoles(config?.approverRoles),
    updatedAt: config?.updatedAt ?? null,
  };
}

export async function upsertApprovalConfig(args: {
  societyId: string;
  actionType: ApprovalActionType;
  enabled: boolean;
  approverRoles?: string[];
}) {
  const approverRoles = normalizeApproverRoles(args.approverRoles);

  const config = await prisma.approvalConfig.upsert({
    where: { societyId_actionType: { societyId: args.societyId, actionType: args.actionType } },
    update: {
      enabled: args.enabled,
      approverRoles: JSON.stringify(approverRoles),
    },
    create: {
      societyId: args.societyId,
      actionType: args.actionType,
      enabled: args.enabled,
      approverRoles: JSON.stringify(approverRoles),
    },
  });

  return {
    societyId: config.societyId,
    actionType: config.actionType,
    enabled: config.enabled,
    approverRoles,
    updatedAt: config.updatedAt,
  };
}

export async function createTenantRegistrationApproval(args: {
  societyId: string;
  requestedById: string;
  requesterName: string;
  requesterComment?: string | null;
  flatId: string;
  pendingData: TenantRegistrationPendingData;
}) {
  const config = await getApprovalConfig(args.societyId, 'TENANT_REGISTRATION');
  if (!config.enabled) {
    throw new Error('APPROVAL_DISABLED');
  }

  const flat = await prisma.flat.findUnique({
    where: { id: args.flatId },
    include: {
      block: { select: { name: true, societyId: true } },
      tenant: { select: { id: true, isActive: true } },
    },
  });

  if (!flat || flat.block.societyId !== args.societyId) {
    throw new Error('FLAT_NOT_FOUND');
  }

  if (flat.tenant?.isActive) {
    throw new Error('ACTIVE_TENANT_EXISTS');
  }

  const approverUserIds = await resolveApprovalApproverUserIds({
    societyId: args.societyId,
    flatId: args.flatId,
    approverRoles: config.approverRoles,
    requesterUserId: args.requestedById,
  });

  const approval = await prisma.$transaction(async (tx) => {
    const existingPending = await tx.approvalRequest.findFirst({
      where: {
        societyId: args.societyId,
        actionType: 'TENANT_REGISTRATION',
        flatId: args.flatId,
        status: 'PENDING',
      },
      select: { id: true },
    });

    if (existingPending) {
      throw new Error('PENDING_APPROVAL_EXISTS');
    }

    const created = await tx.approvalRequest.create({
      data: {
        societyId: args.societyId,
        actionType: 'TENANT_REGISTRATION',
        requestedById: args.requestedById,
        flatId: args.flatId,
        requesterComment: args.requesterComment || null,
        pendingData: args.pendingData as unknown as Prisma.InputJsonValue,
      },
      include: {
        requestedBy: { select: { id: true, name: true, email: true, role: true } },
        flat: { include: { block: { select: { name: true, societyId: true } } } },
      },
    });

    await tx.approvalAuditLog.create({
      data: {
        approvalRequestId: created.id,
        action: 'REQUESTED',
        actorId: args.requestedById,
        comment: args.requesterComment || null,
        snapshot: args.pendingData as unknown as Prisma.InputJsonValue,
      },
    });

    return created;
  });

  await notifyApprovalRequestCreated({
    societyId: args.societyId,
    requestId: approval.id,
    actionType: approval.actionType,
    requesterName: args.requesterName,
    approverUserIds,
    flatLabel: approval.flat ? getFlatLabel(approval.flat) : null,
  });

  return {
    ...approval,
    approverRoles: config.approverRoles,
  };
}

export async function createTenantProfileChangeApproval(args: {
  societyId: string;
  requestedById: string;
  requesterName: string;
  tenantId: string;
  flatId: string;
  requesterComment?: string | null;
  pendingData: TenantProfileChangePendingData;
}) {
  const config = await getApprovalConfig(args.societyId, 'TENANT_PROFILE_CHANGE');
  if (!config.enabled) {
    throw new Error('APPROVAL_DISABLED');
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: args.tenantId },
    include: {
      flat: {
        include: {
          block: { select: { name: true, societyId: true } },
        },
      },
    },
  });

  if (!tenant || tenant.flat.block.societyId !== args.societyId || !tenant.isActive) {
    throw new Error('TENANT_NOT_FOUND');
  }

  const approverUserIds = await resolveApprovalApproverUserIds({
    societyId: args.societyId,
    flatId: args.flatId,
    approverRoles: config.approverRoles,
    requesterUserId: args.requestedById,
  });

  const approval = await prisma.$transaction(async (tx) => {
    const existingPending = await tx.approvalRequest.findFirst({
      where: {
        societyId: args.societyId,
        actionType: 'TENANT_PROFILE_CHANGE',
        tenantId: args.tenantId,
        status: 'PENDING',
      },
      select: { id: true },
    });

    if (existingPending) {
      throw new Error('PENDING_APPROVAL_EXISTS');
    }

    const created = await tx.approvalRequest.create({
      data: {
        societyId: args.societyId,
        actionType: 'TENANT_PROFILE_CHANGE',
        requestedById: args.requestedById,
        flatId: args.flatId,
        tenantId: args.tenantId,
        relatedUserId: args.requestedById,
        requesterComment: args.requesterComment || null,
        pendingData: args.pendingData as unknown as Prisma.InputJsonValue,
      },
      include: {
        requestedBy: { select: { id: true, name: true, email: true, role: true } },
        flat: { include: { block: { select: { name: true, societyId: true } } } },
        tenant: { select: { id: true, name: true, email: true, phone: true, isActive: true } },
      },
    });

    await tx.approvalAuditLog.create({
      data: {
        approvalRequestId: created.id,
        action: 'REQUESTED',
        actorId: args.requestedById,
        comment: args.requesterComment || null,
        snapshot: args.pendingData as unknown as Prisma.InputJsonValue,
      },
    });

    return created;
  });

  await notifyApprovalRequestCreated({
    societyId: args.societyId,
    requestId: approval.id,
    actionType: approval.actionType,
    requesterName: args.requesterName,
    approverUserIds,
    flatLabel: approval.flat ? getFlatLabel(approval.flat) : null,
  });

  return {
    ...approval,
    approverRoles: config.approverRoles,
  };
}

async function applyApprovedTenantRegistration(tx: Prisma.TransactionClient, approvalRequestId: string) {
  const approval = await tx.approvalRequest.findUnique({
    where: { id: approvalRequestId },
    include: {
      flat: {
        include: {
          block: {
            select: {
              name: true,
              societyId: true,
              society: { select: { name: true } },
            },
          },
          tenant: true,
        },
      },
    },
  });

  if (!approval || approval.actionType !== 'TENANT_REGISTRATION' || !approval.flat) {
    throw new Error('APPROVAL_NOT_FOUND');
  }

  if (approval.flat.tenant?.isActive) {
    throw new Error('ACTIVE_TENANT_EXISTS');
  }

  const data = parseTenantRegistrationPendingData(approval.pendingData);
  const legacyVehicleFields = buildLegacyVehicleFields(data.vehicles);

  let tenantUserId: string | null = null;
  let createdNewUser = false;
  if (data.email && data.phone) {
    const existingUser = await findUserByEmailInsensitive(tx, data.email);

    if (existingUser) {
      const sameSocietyMembership = await tx.userSocietyMembership.findUnique({
        where: { userId_societyId: { userId: existingUser.id, societyId: approval.societyId } },
        select: { id: true },
      });
      if (!sameSocietyMembership) {
        await tx.userSocietyMembership.create({
          data: {
            userId: existingUser.id,
            societyId: approval.societyId,
            role: getLinkedMembershipRole(existingUser, approval.societyId, 'TENANT') as Role,
          },
        });
      }
      tenantUserId = existingUser.id;
    } else {
      const passwordHash = await bcrypt.hash(data.phone, 12);
      const newUser = await tx.user.create({
        data: {
          email: data.email,
          passwordHash,
          name: data.name,
          phone: data.phone,
          role: 'TENANT',
          societyId: approval.societyId,
          activeSocietyId: approval.societyId,
          mustChangePassword: true,
        },
      });
      await tx.userSocietyMembership.create({
        data: { userId: newUser.id, societyId: approval.societyId, role: 'TENANT' },
      });
      tenantUserId = newUser.id;
      createdNewUser = true;
    }
  }

  if (approval.flat.tenant && !approval.flat.tenant.isActive) {
    await tx.tenant.delete({ where: { id: approval.flat.tenant.id } });
  }

  const tenant = await tx.tenant.create({
    data: {
      name: data.name,
      phone: data.phone,
      email: data.email,
      ...legacyVehicleFields,
      altPhone: data.altPhone,
      aadharNo: data.aadharNo,
      flatId: approval.flatId!,
      leaseStart: new Date(data.leaseStart),
      leaseEnd: data.leaseEnd ? new Date(data.leaseEnd) : null,
      rentAmount: data.rentAmount,
      deposit: data.deposit,
      userId: tenantUserId,
      ...(data.vehicles.length ? { vehicles: { create: data.vehicles } } : {}),
    },
  });

  return {
    tenant,
    accountLinked: !!tenantUserId,
    accountCreated: createdNewUser,
    flatNumber: approval.flat.flatNumber,
    blockName: approval.flat.block?.name || null,
    societyName: approval.flat.block?.society?.name || 'your society',
    email: data.email,
    phone: data.phone,
    name: data.name,
  };
}

async function applyApprovedTenantProfileChange(tx: Prisma.TransactionClient, approvalRequestId: string) {
  const approval = await tx.approvalRequest.findUnique({
    where: { id: approvalRequestId },
    include: {
      tenant: true,
    },
  });

  if (!approval || approval.actionType !== 'TENANT_PROFILE_CHANGE' || !approval.tenant) {
    throw new Error('APPROVAL_NOT_FOUND');
  }

  if (!approval.tenant.isActive) {
    throw new Error('TENANT_NOT_FOUND');
  }

  const data = parseTenantProfileChangePendingData(approval.pendingData);
  const legacyVehicleFields = buildLegacyVehicleFields(data.vehicles);

  const tenant = await tx.tenant.update({
    where: { id: approval.tenant.id },
    data: {
      occupation: data.occupation,
      householdAdults: data.householdAdults,
      householdKids: data.householdKids,
      householdSeniors: data.householdSeniors,
      pets: data.pets,
      carNumber: legacyVehicleFields.carNumber,
      twoWheelerNumber: legacyVehicleFields.twoWheelerNumber,
      vehicles: {
        deleteMany: {},
        ...(data.vehicles.length ? { create: data.vehicles } : {}),
      },
    },
  });

  return { tenant };
}

export async function listApprovalRequests(args: {
  societyId: string;
  userId: string;
  userRole: string;
  status?: ApprovalStatus;
  actionType?: ApprovalActionType;
}) {
  const [records, configs] = await Promise.all([
    prisma.approvalRequest.findMany({
      where: {
        societyId: args.societyId,
        ...(args.status ? { status: args.status } : {}),
        ...(args.actionType ? { actionType: args.actionType } : {}),
      },
      include: {
        requestedBy: { select: { id: true, name: true, email: true, role: true } },
        approvedBy: { select: { id: true, name: true, email: true, role: true } },
        rejectedBy: { select: { id: true, name: true, email: true, role: true } },
        flat: {
          include: {
            block: { select: { name: true } },
            owner: { select: { userId: true, isActive: true } },
            tenant: { select: { userId: true, isActive: true } },
          },
        },
        tenant: { select: { id: true, name: true, email: true, phone: true, isActive: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    }),
    prisma.approvalConfig.findMany({ where: { societyId: args.societyId } }),
  ]);

  const configMap = new Map(configs.map((config) => [config.actionType, parseApproverRoles(config.approverRoles)]));

  const visibleRecords = records.filter((record) => {
    const approverRoles = configMap.get(record.actionType) || [...DEFAULT_APPROVER_ROLES];
    return canReviewRequest({
      userId: args.userId,
      userRole: args.userRole,
      record,
      approverRoles,
    });
  });

  const readStateMap = await getCommunityItemReadStateMap({
    itemType: COMMUNITY_READ_ITEM_TYPES.APPROVAL,
    userId: args.userId,
    itemIds: visibleRecords.map((record) => record.id),
  });

  return visibleRecords.map((record) => ({
    ...record,
    approverRoles: configMap.get(record.actionType) || [...DEFAULT_APPROVER_ROLES],
    isRead: readStateMap.has(record.id),
    readAt: readStateMap.get(record.id)?.toISOString() || null,
  }));
}

export async function getApprovalRequestById(args: {
  requestId: string;
  societyId: string;
  userId: string;
  userRole: string;
}) {
  const record = await prisma.approvalRequest.findUnique({
    where: { id: args.requestId },
    include: {
      requestedBy: { select: { id: true, name: true, email: true, role: true } },
      approvedBy: { select: { id: true, name: true, email: true, role: true } },
      rejectedBy: { select: { id: true, name: true, email: true, role: true } },
      flat: {
        include: {
          block: { select: { name: true } },
          owner: { select: { userId: true, isActive: true } },
          tenant: { select: { userId: true, isActive: true } },
        },
      },
      tenant: { select: { id: true, name: true, email: true, phone: true, isActive: true } },
      auditLogs: {
        include: {
          actor: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!record || record.societyId !== args.societyId) {
    return null;
  }

  const config = await getApprovalConfig(args.societyId, record.actionType);
  if (!canReviewRequest({
    userId: args.userId,
    userRole: args.userRole,
    record,
    approverRoles: config.approverRoles,
  })) {
    throw new Error('FORBIDDEN');
  }

  const readStateMap = await getCommunityItemReadStateMap({
    itemType: COMMUNITY_READ_ITEM_TYPES.APPROVAL,
    userId: args.userId,
    itemIds: [record.id],
  });

  return {
    ...record,
    approverRoles: config.approverRoles,
    isRead: readStateMap.has(record.id),
    readAt: readStateMap.get(record.id)?.toISOString() || null,
  };
}

export async function approveApprovalRequest(args: {
  requestId: string;
  societyId: string;
  actorId: string;
  actorRole: string;
  actorName: string;
  comment?: string | null;
}) {
  const existing = await prisma.approvalRequest.findUnique({
    where: { id: args.requestId },
    include: {
      requestedBy: { select: { id: true } },
      flat: {
        include: {
          owner: { select: { userId: true, isActive: true } },
          tenant: { select: { userId: true, isActive: true } },
        },
      },
    },
  });

  if (!existing || existing.societyId !== args.societyId) {
    throw new Error('NOT_FOUND');
  }

  if (existing.status !== 'PENDING') {
    throw new Error('APPROVAL_NOT_PENDING');
  }

  const config = await getApprovalConfig(args.societyId, existing.actionType);
  if (!canActOnRequest({
    actorId: args.actorId,
    actorRole: args.actorRole,
    record: existing,
    approverRoles: config.approverRoles,
  })) {
    throw new Error('FORBIDDEN');
  }

  const result = await prisma.$transaction(async (tx) => {
    let appliedTenant: Awaited<ReturnType<typeof applyApprovedTenantRegistration>> | null = null;
    let appliedTenantProfile: Awaited<ReturnType<typeof applyApprovedTenantProfileChange>> | null = null;
    if (existing.actionType === 'TENANT_REGISTRATION') {
      appliedTenant = await applyApprovedTenantRegistration(tx, existing.id);
    } else if (existing.actionType === 'TENANT_PROFILE_CHANGE') {
      appliedTenantProfile = await applyApprovedTenantProfileChange(tx, existing.id);
    } else {
      throw new Error('UNSUPPORTED_APPROVAL_ACTION');
    }

    const updated = await tx.approvalRequest.update({
      where: { id: existing.id },
      data: {
        status: 'APPROVED',
        approvedById: args.actorId,
        approvedAt: new Date(),
        decisionComment: args.comment || null,
        ...(appliedTenant?.tenant?.id ? { tenantId: appliedTenant.tenant.id } : {}),
        ...(appliedTenantProfile?.tenant?.id ? { tenantId: appliedTenantProfile.tenant.id } : {}),
      },
      include: {
        requestedBy: { select: { id: true, name: true, email: true, role: true } },
        approvedBy: { select: { id: true, name: true, email: true, role: true } },
        flat: { include: { block: { select: { name: true } } } },
        tenant: { select: { id: true, name: true, email: true, phone: true, isActive: true } },
      },
    });

    await tx.approvalAuditLog.create({
      data: {
        approvalRequestId: existing.id,
        action: 'APPROVED',
        actorId: args.actorId,
        comment: args.comment || null,
      },
    });

    return { updated, appliedTenant, appliedTenantProfile };
  });

  if (result.appliedTenant?.email && result.appliedTenant.accountLinked) {
    sendResidentOnboardingEmail(result.appliedTenant.email, {
      userName: result.appliedTenant.name,
      societyName: result.appliedTenant.societyName,
      flatNumber: result.appliedTenant.flatNumber,
      blockName: result.appliedTenant.blockName,
      relation: 'TENANT',
      loginEmail: result.appliedTenant.email,
      phoneNumber: result.appliedTenant.phone,
      accountCreated: result.appliedTenant.accountCreated,
    }).catch((error: any) => {
      logger.error('Resident onboarding email failed after approval', {
        approvalRequestId: args.requestId,
        email: result.appliedTenant?.email,
        error: error.message,
      });
    });
  }

  await notifyApprovalRequestResolved({
    societyId: args.societyId,
    requestId: result.updated.id,
    requesterUserId: result.updated.requestedBy.id,
    actionType: result.updated.actionType,
    status: 'APPROVED',
    decisionByName: args.actorName,
  });

  return {
    ...result.updated,
    approverRoles: config.approverRoles,
  };
}

export async function rejectApprovalRequest(args: {
  requestId: string;
  societyId: string;
  actorId: string;
  actorRole: string;
  actorName: string;
  comment?: string | null;
}) {
  const existing = await prisma.approvalRequest.findUnique({
    where: { id: args.requestId },
    include: {
      requestedBy: { select: { id: true } },
      flat: {
        include: {
          owner: { select: { userId: true, isActive: true } },
          tenant: { select: { userId: true, isActive: true } },
        },
      },
    },
  });

  if (!existing || existing.societyId !== args.societyId) {
    throw new Error('NOT_FOUND');
  }

  if (existing.status !== 'PENDING') {
    throw new Error('APPROVAL_NOT_PENDING');
  }

  const config = await getApprovalConfig(args.societyId, existing.actionType);
  if (!canActOnRequest({
    actorId: args.actorId,
    actorRole: args.actorRole,
    record: existing,
    approverRoles: config.approverRoles,
  })) {
    throw new Error('FORBIDDEN');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const request = await tx.approvalRequest.update({
      where: { id: existing.id },
      data: {
        status: 'REJECTED',
        rejectedById: args.actorId,
        rejectedAt: new Date(),
        decisionComment: args.comment || null,
      },
      include: {
        requestedBy: { select: { id: true, name: true, email: true, role: true } },
        rejectedBy: { select: { id: true, name: true, email: true, role: true } },
        flat: { include: { block: { select: { name: true } } } },
        tenant: { select: { id: true, name: true, email: true, phone: true, isActive: true } },
      },
    });

    await tx.approvalAuditLog.create({
      data: {
        approvalRequestId: existing.id,
        action: 'REJECTED',
        actorId: args.actorId,
        comment: args.comment || null,
      },
    });

    return request;
  });

  await notifyApprovalRequestResolved({
    societyId: args.societyId,
    requestId: updated.id,
    requesterUserId: updated.requestedBy.id,
    actionType: updated.actionType,
    status: 'REJECTED',
    decisionByName: args.actorName,
  });

  return {
    ...updated,
    approverRoles: config.approverRoles,
  };
}
