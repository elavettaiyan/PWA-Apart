import { Role } from '@prisma/client';
import prisma from '../../config/database';
import { AuthRequest } from '../../middleware/auth';

export const ASSIGNABLE_ROLES = ['SECRETARY', 'JOINT_SECRETARY', 'TREASURER', 'COMMITTEE_MEMBER', 'OWNER', 'SERVICE_STAFF'] as const;
export const CONFIGURABLE_MENU_ROLES = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER', 'COMMITTEE_MEMBER', 'OWNER', 'TENANT'] as const;
export const DEFAULT_ADMIN_ASSIGNMENT_TYPE = 'PRESIDENT';
export const TRANSFERABLE_ADMIN_ASSIGNMENT_TYPES = new Set(['TEMPORARY', 'PRESIDENT']);

const ROLE_LIMITS: Partial<Record<string, number>> = {
  ADMIN: 1,
  SECRETARY: 1,
  JOINT_SECRETARY: 2,
  TREASURER: 1,
};

const MENU_CATALOG = [
  { id: 'dashboard', label: 'Dashboard', href: '/' },
  { id: 'community', label: 'Community', href: '/community' },
  { id: 'flats', label: 'Flats & Residents', href: '/flats' },
  { id: 'my-flat', label: 'My Flat', href: '/my-flat' },
  { id: 'billing', label: 'Billing', href: '/billing' },
  { id: 'complaints', label: 'Complaints', href: '/complaints' },
  { id: 'gate-management', label: 'Gate Management', href: '/gate-management' },
  { id: 'expenses', label: 'Expenses', href: '/expenses' },
  { id: 'assets', label: 'Assets', href: '/assets' },
  { id: 'reports', label: 'Reports', href: '/reports' },
  { id: 'settings', label: 'Settings', href: '/settings' },
] as const;

const ROLE_LABELS: Record<(typeof CONFIGURABLE_MENU_ROLES)[number], string> = {
  ADMIN: 'Admin',
  SECRETARY: 'Secretary',
  JOINT_SECRETARY: 'Joint Secretary',
  TREASURER: 'Treasurer',
  COMMITTEE_MEMBER: 'Committee Member',
  OWNER: 'Owner',
  TENANT: 'Tenant',
};

type MenuId = (typeof MENU_CATALOG)[number]['id'];
export type ConfigurableMenuRole = (typeof CONFIGURABLE_MENU_ROLES)[number];

const MENU_ID_SET = new Set<MenuId>(MENU_CATALOG.map((item) => item.id));

const BASELINE_MENU_IDS_BY_ROLE: Record<ConfigurableMenuRole, MenuId[]> = {
  ADMIN: ['dashboard', 'my-flat', 'billing', 'settings'],
  SECRETARY: ['dashboard', 'my-flat', 'billing', 'settings'],
  JOINT_SECRETARY: ['dashboard', 'my-flat', 'billing'],
  TREASURER: ['my-flat', 'billing', 'expenses', 'reports'],
  COMMITTEE_MEMBER: ['dashboard'],
  OWNER: ['my-flat', 'billing'],
  TENANT: ['my-flat', 'billing'],
};

const DEFAULT_MENU_IDS_BY_ROLE: Record<ConfigurableMenuRole, MenuId[]> = {
  ADMIN: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'gate-management', 'expenses', 'assets', 'reports', 'settings'],
  SECRETARY: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'assets', 'reports', 'settings'],
  JOINT_SECRETARY: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'assets'],
  TREASURER: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'expenses', 'reports'],
  COMMITTEE_MEMBER: ['dashboard', 'community', 'my-flat', 'complaints'],
  OWNER: ['dashboard', 'community', 'my-flat', 'billing', 'complaints'],
  TENANT: ['dashboard', 'community', 'my-flat', 'billing', 'complaints'],
};

const ALLOWED_MENU_IDS_BY_ROLE: Record<ConfigurableMenuRole, MenuId[]> = {
  ADMIN: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'gate-management', 'expenses', 'assets', 'reports', 'settings'],
  SECRETARY: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'gate-management', 'expenses', 'assets', 'reports', 'settings'],
  JOINT_SECRETARY: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'gate-management', 'expenses', 'assets', 'reports'],
  TREASURER: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'expenses', 'reports'],
  COMMITTEE_MEMBER: ['dashboard', 'community', 'my-flat', 'complaints'],
  OWNER: ['dashboard', 'community', 'my-flat', 'billing', 'complaints'],
  TENANT: ['dashboard', 'community', 'my-flat', 'billing', 'complaints'],
};

const LEGACY_MENU_ID_MAP: Record<string, MenuId> = {
  announcements: 'community',
  events: 'community',
  'entry-activity': 'community',
};

export function normalizeAdminAssignmentType(role: string, adminAssignmentType?: string | null) {
  if (role !== 'ADMIN') return null;
  return adminAssignmentType || DEFAULT_ADMIN_ASSIGNMENT_TYPE;
}

export async function getCommitteeMemberLimit(societyId: string) {
  const settings = await prisma.societySettings.findUnique({
    where: { societyId },
    select: { committeeMemberLimit: true },
  });

  return settings?.committeeMemberLimit ?? 0;
}

export function getRoleLimit(role: string) {
  return ROLE_LIMITS[role];
}

export async function syncUserPrimaryMembershipRole(tx: any, userId: string) {
  const [user, memberships] = await Promise.all([
    tx.user.findUnique({ where: { id: userId }, select: { activeSocietyId: true, societyId: true } }),
    tx.userSocietyMembership.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { societyId: true, role: true } }),
  ]);

  if (!user) return;

  if (memberships.length === 0) {
    await tx.user.update({ where: { id: userId }, data: { role: 'OWNER', societyId: null, activeSocietyId: null, isActive: false } });
    return;
  }

  const activeMembership = memberships.find((membership: any) => membership.societyId === user.activeSocietyId);
  const defaultMembership = memberships.find((membership: any) => membership.societyId === user.societyId);
  const fallbackMembership = activeMembership || defaultMembership || memberships[0];

  await tx.user.update({
    where: { id: userId },
    data: {
      role: fallbackMembership.role,
      societyId: defaultMembership?.societyId || fallbackMembership.societyId,
      activeSocietyId: activeMembership?.societyId || fallbackMembership.societyId,
      isActive: true,
    },
  });
}

export async function hasActiveOwnerRecord(tx: any, userId: string, societyId: string) {
  const owner = await tx.owner.findFirst({
    where: { userId, isActive: true, flat: { block: { societyId } } },
    select: { id: true },
  });

  return Boolean(owner);
}

export function getRequestOrigin(req: AuthRequest) {
  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
  const protocol = forwardedProto || req.protocol;
  const host = forwardedHost || req.get('host');

  return host ? `${protocol}://${host}` : '';
}

export function getDefaultRedirectUrl() {
  return `${process.env.CLIENT_URL || 'http://localhost:5173'}/billing?payment=done`;
}

export function getPhonePeAuthBaseUrl(environment: string) {
  return environment === 'PRODUCTION'
    ? 'https://api.phonepe.com/apis/identity-manager'
    : 'https://api-preprod.phonepe.com/apis/pg-sandbox';
}

export function maskPaymentGatewayConfig(config: any) {
  return {
    ...config,
    saltKey: config.saltKey ? `${'•'.repeat(Math.max(0, config.saltKey.length - 4))}${config.saltKey.slice(-4)}` : '',
    saltKeySet: !!config.saltKey,
    clientSecret: config.clientSecret ? `${'•'.repeat(Math.max(0, config.clientSecret.length - 4))}${config.clientSecret.slice(-4)}` : '',
    clientSecretSet: !!config.clientSecret,
  };
}

function isConfigurableMenuRole(value: string): value is ConfigurableMenuRole {
  return (CONFIGURABLE_MENU_ROLES as readonly string[]).includes(value);
}

function normalizeMenuIds(value: unknown): MenuId[] {
  if (!Array.isArray(value)) return [];

  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => LEGACY_MENU_ID_MAP[item] || item)
    .filter((item): item is MenuId => MENU_ID_SET.has(item as MenuId));

  return [...new Set(normalized)];
}

function parseVisibleMenuIds(rawValue?: string | null): MenuId[] {
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    return normalizeMenuIds(parsed);
  } catch {
    return [];
  }
}

export function normalizeVisibleMenuIds(role: ConfigurableMenuRole, value: unknown): MenuId[] {
  const requestedIds = Array.isArray(value) ? normalizeMenuIds(value) : DEFAULT_MENU_IDS_BY_ROLE[role];
  const mandatoryIds = new Set(BASELINE_MENU_IDS_BY_ROLE[role]);
  const allowedIds = new Set(ALLOWED_MENU_IDS_BY_ROLE[role]);
  const normalizedIds = [...new Set(requestedIds)].filter((item) => allowedIds.has(item));

  for (const mandatoryId of mandatoryIds) {
    if (!normalizedIds.includes(mandatoryId)) normalizedIds.push(mandatoryId);
  }

  return MENU_CATALOG.filter((item) => normalizedIds.includes(item.id)).map((item) => item.id);
}

export function getDefaultMenuIdsForRole(role: ConfigurableMenuRole) {
  return DEFAULT_MENU_IDS_BY_ROLE[role];
}

function buildRoleMenuConfig(role: ConfigurableMenuRole, storedVisibleMenuIds: MenuId[]) {
  const mandatoryMenuIds = BASELINE_MENU_IDS_BY_ROLE[role];
  const defaultMenuIds = DEFAULT_MENU_IDS_BY_ROLE[role];
  const allowedIds = ALLOWED_MENU_IDS_BY_ROLE[role];
  const allowedIdSet = new Set<MenuId>(allowedIds);
  const mandatoryIdSet = new Set<MenuId>(mandatoryMenuIds);
  const defaultIdSet = new Set<MenuId>(defaultMenuIds);
  const visibleMenuIds = normalizeVisibleMenuIds(role, storedVisibleMenuIds.length > 0 ? storedVisibleMenuIds : defaultMenuIds);
  const visibleIdSet = new Set<MenuId>(visibleMenuIds);

  return {
    role,
    roleLabel: ROLE_LABELS[role],
    mandatoryMenuIds,
    defaultMenuIds,
    visibleMenuIds,
    menuItems: MENU_CATALOG.map((item) => ({
      id: item.id,
      label: item.label,
      href: item.href,
      allowed: allowedIdSet.has(item.id),
      mandatory: mandatoryIdSet.has(item.id),
      enabled: visibleIdSet.has(item.id),
      defaultEnabled: defaultIdSet.has(item.id),
      selectable: allowedIdSet.has(item.id) && !mandatoryIdSet.has(item.id),
    })),
  };
}

export async function getRoleMenuConfigResponse(societyId: string) {
  const configs = await prisma.societyRoleMenuConfig.findMany({
    where: { societyId, role: { in: [...CONFIGURABLE_MENU_ROLES] as Role[] } },
  });

  const configMap = new Map<ConfigurableMenuRole, MenuId[]>();
  for (const config of configs) {
    if (isConfigurableMenuRole(config.role)) {
      configMap.set(config.role, parseVisibleMenuIds(config.visibleMenuIds));
    }
  }

  return {
    societyId,
    configurableRoles: CONFIGURABLE_MENU_ROLES.map((role) => buildRoleMenuConfig(role, configMap.get(role) || [])),
  };
}