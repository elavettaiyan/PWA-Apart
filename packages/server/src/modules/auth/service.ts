import { Request } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config';

export const ACCOUNT_DELETION_ALLOWED_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER', 'OWNER', 'TENANT', 'SERVICE_STAFF'] as const;
export const REVIEW_DELETE_ACCOUNT_OTP = '123456';
export const OWNER_VIEW_ELIGIBLE_ROLES = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER'];
export const DEFAULT_ADMIN_ASSIGNMENT_TYPE = 'PRESIDENT';

export function normalizeAdminAssignmentType(role: string, adminAssignmentType?: string | null) {
  if (role !== 'ADMIN') return null;
  return adminAssignmentType || DEFAULT_ADMIN_ASSIGNMENT_TYPE;
}

export function buildSocietyScopedUserPayload(args: {
  user: {
    id: string;
    email: string;
    name: string;
    phone?: string | null;
    role: string;
    specialization?: string | null;
    societyId?: string | null;
    activeSocietyId?: string | null;
    mustChangePassword?: boolean | null;
    skipAccountDeletionVerification?: boolean | null;
    owners: Array<{ flat: any | null; isActive?: boolean | null }>;
    tenants: Array<{ flat: any | null; isActive?: boolean | null }>;
    societyMemberships: Array<{
      societyId: string;
      role: string;
      adminAssignmentType?: string | null;
      adminAssignedAt?: Date | null;
      society: { id: string; name: string };
    }>;
  };
}) {
  const activeSocietyId = args.user.activeSocietyId || args.user.societyId || args.user.societyMemberships[0]?.societyId || null;
  const flatFromOwners = args.user.owners.find((owner) => owner.isActive !== false && owner.flat?.block?.societyId === activeSocietyId)?.flat || null;
  const flatFromTenants = args.user.tenants.find((tenant) => tenant.isActive !== false && tenant.flat?.block?.societyId === activeSocietyId)?.flat || null;
  const activeMembership = activeSocietyId
    ? args.user.societyMemberships.find((membership) => membership.societyId === activeSocietyId)
    : null;
  const effectiveRole = args.user.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : (activeMembership?.role || args.user.role);
  const adminAssignmentType = normalizeAdminAssignmentType(effectiveRole, activeMembership?.adminAssignmentType);
  const canUseOwnerView = OWNER_VIEW_ELIGIBLE_ROLES.includes(effectiveRole) && Boolean(flatFromOwners);

  return {
    id: args.user.id,
    email: args.user.email,
    name: args.user.name,
    phone: args.user.phone || undefined,
    role: effectiveRole,
    specialization: args.user.specialization,
    societyId: activeSocietyId,
    activeSocietyId,
    flat: flatFromOwners || flatFromTenants || null,
    flatRelation: flatFromOwners ? 'OWNER' : flatFromTenants ? 'TENANT' : null,
    canUseOwnerView,
    adminAssignmentType,
    adminAssignedAt: activeMembership?.adminAssignedAt || null,
    isTemporaryAdmin: adminAssignmentType === 'TEMPORARY',
    mustChangePassword: Boolean(args.user.mustChangePassword),
    skipAccountDeletionVerification: Boolean(args.user.skipAccountDeletionVerification),
    societies: args.user.societyMemberships.map((membership) => ({
      id: membership.society.id,
      name: membership.society.name,
      role: membership.role,
      adminAssignmentType: normalizeAdminAssignmentType(membership.role, membership.adminAssignmentType),
    })),
  };
}

export type ClientMedium = 'web' | 'android' | 'ios';

export function detectClientMedium(req: Request, requestedMedium?: string): ClientMedium {
  if (requestedMedium === 'web' || requestedMedium === 'android' || requestedMedium === 'ios') {
    return requestedMedium;
  }

  const userAgent = (req.get('user-agent') || '').toLowerCase();
  if (userAgent.includes('android')) return 'android';
  if (userAgent.includes('iphone') || userAgent.includes('ipad') || userAgent.includes('ios')) return 'ios';
  return 'web';
}

export function generateTokens(user: { id: string; email: string; role: string; societyId?: string | null }) {
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