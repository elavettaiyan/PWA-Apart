import type {
  ConfigurableMenuRole,
  MenuVisibilityResponse,
  NavigationMenuId,
  Role,
  RoleMenuVisibilityConfig,
  User,
} from '../types';
import { isNonSecurityServiceStaff, isSecurityServiceStaff } from './serviceStaff';

export const NAVIGATION_MENU_CATALOG = [
  { id: 'dashboard', label: 'Dashboard', href: '/' },
  { id: 'announcements', label: 'Announcements', href: '/announcements' },
  { id: 'events', label: 'Events', href: '/events' },
  { id: 'flats', label: 'Flats & Residents', href: '/flats' },
  { id: 'my-flat', label: 'My Flat', href: '/my-flat' },
  { id: 'billing', label: 'Billing', href: '/billing' },
  { id: 'complaints', label: 'Complaints', href: '/complaints' },
  { id: 'gate-management', label: 'Gate Management', href: '/gate-management' },
  { id: 'entry-activity', label: 'Entry Activity', href: '/entry-activity' },
  { id: 'expenses', label: 'Expenses', href: '/expenses' },
  { id: 'reports', label: 'Reports', href: '/reports' },
  { id: 'settings', label: 'Settings', href: '/settings' },
] as const satisfies ReadonlyArray<{ id: NavigationMenuId; label: string; href: string }>;

export const CONFIGURABLE_MENU_ROLES: ConfigurableMenuRole[] = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER', 'OWNER', 'TENANT'];

const BASELINE_MENU_IDS_BY_ROLE: Record<ConfigurableMenuRole, NavigationMenuId[]> = {
  ADMIN: ['dashboard', 'my-flat', 'billing', 'settings'],
  SECRETARY: ['dashboard', 'my-flat', 'billing', 'settings'],
  JOINT_SECRETARY: ['dashboard', 'my-flat', 'billing'],
  TREASURER: ['my-flat', 'billing', 'expenses', 'reports'],
  OWNER: ['my-flat', 'billing'],
  TENANT: ['my-flat', 'billing'],
};

const DEFAULT_MENU_IDS_BY_ROLE: Record<ConfigurableMenuRole, NavigationMenuId[]> = {
  ADMIN: ['dashboard', 'announcements', 'events', 'flats', 'my-flat', 'billing', 'complaints', 'gate-management', 'entry-activity', 'expenses', 'reports', 'settings'],
  SECRETARY: ['dashboard', 'announcements', 'events', 'flats', 'my-flat', 'billing', 'complaints', 'entry-activity', 'reports', 'settings'],
  JOINT_SECRETARY: ['dashboard', 'announcements', 'events', 'flats', 'my-flat', 'billing', 'complaints', 'entry-activity'],
  TREASURER: ['dashboard', 'announcements', 'events', 'flats', 'my-flat', 'billing', 'complaints', 'expenses', 'reports'],
  OWNER: ['dashboard', 'announcements', 'events', 'my-flat', 'billing', 'complaints'],
  TENANT: ['dashboard', 'announcements', 'events', 'my-flat', 'billing', 'complaints'],
};

const ALLOWED_MENU_IDS_BY_ROLE: Record<ConfigurableMenuRole, NavigationMenuId[]> = {
  ADMIN: ['dashboard', 'announcements', 'events', 'flats', 'my-flat', 'billing', 'complaints', 'gate-management', 'entry-activity', 'expenses', 'reports', 'settings'],
  SECRETARY: ['dashboard', 'announcements', 'events', 'flats', 'my-flat', 'billing', 'complaints', 'gate-management', 'entry-activity', 'expenses', 'reports', 'settings'],
  JOINT_SECRETARY: ['dashboard', 'announcements', 'events', 'flats', 'my-flat', 'billing', 'complaints', 'gate-management', 'entry-activity', 'expenses', 'reports'],
  TREASURER: ['dashboard', 'announcements', 'events', 'flats', 'my-flat', 'billing', 'complaints', 'expenses', 'reports'],
  OWNER: ['dashboard', 'announcements', 'events', 'my-flat', 'billing', 'complaints'],
  TENANT: ['dashboard', 'announcements', 'events', 'my-flat', 'billing', 'complaints'],
};

const ROLE_LABELS: Record<ConfigurableMenuRole, string> = {
  ADMIN: 'Admin',
  SECRETARY: 'Secretary',
  JOINT_SECRETARY: 'Joint Secretary',
  TREASURER: 'Treasurer',
  OWNER: 'Owner',
  TENANT: 'Tenant',
};

function normalizeVisibleMenuIds(role: ConfigurableMenuRole, requestedMenuIds: NavigationMenuId[]) {
  const mandatoryIdSet = new Set(BASELINE_MENU_IDS_BY_ROLE[role]);
  const allowedIdSet = new Set(ALLOWED_MENU_IDS_BY_ROLE[role]);
  const normalized = [...new Set(requestedMenuIds)].filter((menuId) => allowedIdSet.has(menuId));

  for (const mandatoryMenuId of mandatoryIdSet) {
    if (!normalized.includes(mandatoryMenuId)) {
      normalized.push(mandatoryMenuId);
    }
  }

  return NAVIGATION_MENU_CATALOG.filter((item) => normalized.includes(item.id)).map((item) => item.id);
}

function buildRoleMenuVisibility(role: ConfigurableMenuRole, requestedVisibleMenuIds: NavigationMenuId[]): RoleMenuVisibilityConfig {
  const mandatoryMenuIds = BASELINE_MENU_IDS_BY_ROLE[role];
  const defaultMenuIds = DEFAULT_MENU_IDS_BY_ROLE[role];
  const allowedIdSet = new Set(ALLOWED_MENU_IDS_BY_ROLE[role]);
  const mandatoryIdSet = new Set(mandatoryMenuIds);
  const defaultIdSet = new Set(defaultMenuIds);
  const visibleMenuIds = normalizeVisibleMenuIds(role, requestedVisibleMenuIds.length ? requestedVisibleMenuIds : defaultMenuIds);
  const visibleIdSet = new Set<NavigationMenuId>(visibleMenuIds);

  return {
    role,
    roleLabel: ROLE_LABELS[role],
    mandatoryMenuIds,
    defaultMenuIds,
    visibleMenuIds,
    menuItems: NAVIGATION_MENU_CATALOG.map((item) => ({
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

export function getFallbackMenuVisibility(societyId = ''): MenuVisibilityResponse {
  return {
    societyId,
    configurableRoles: CONFIGURABLE_MENU_ROLES.map((role) => buildRoleMenuVisibility(role, [])),
  };
}

export function getRoleMenuVisibilityConfig(role: Role | undefined, menuVisibility?: MenuVisibilityResponse | null) {
  if (!role || !CONFIGURABLE_MENU_ROLES.includes(role as ConfigurableMenuRole)) {
    return null;
  }

  return menuVisibility?.configurableRoles.find((config) => config.role === role)
    || buildRoleMenuVisibility(role as ConfigurableMenuRole, []);
}

export function getVisibleMenuIdsForUser(user?: User | null, menuVisibility?: MenuVisibilityResponse | null): NavigationMenuId[] {
  if (!user) {
    return [];
  }

  if (user.role === 'SUPER_ADMIN') {
    return NAVIGATION_MENU_CATALOG.map((item) => item.id);
  }

  if (isSecurityServiceStaff(user)) {
    return ['gate-management', 'entry-activity'];
  }

  if (isNonSecurityServiceStaff(user)) {
    return ['complaints'];
  }

  const roleConfig = getRoleMenuVisibilityConfig(user.role, menuVisibility);
  return roleConfig?.visibleMenuIds || [];
}

export function getVisibleNavigationItemsForUser(user?: User | null, menuVisibility?: MenuVisibilityResponse | null) {
  const visibleIdSet = new Set(getVisibleMenuIdsForUser(user, menuVisibility));
  return NAVIGATION_MENU_CATALOG.filter((item) => visibleIdSet.has(item.id));
}

export function getAvailableOptionalMenuIds(role: ConfigurableMenuRole) {
  const mandatoryIdSet = new Set(BASELINE_MENU_IDS_BY_ROLE[role]);
  return ALLOWED_MENU_IDS_BY_ROLE[role].filter((menuId) => !mandatoryIdSet.has(menuId));
}