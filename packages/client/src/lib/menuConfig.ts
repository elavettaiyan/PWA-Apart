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
  { id: 'community', label: 'Community', href: '/community' },
  { id: 'flats', label: 'Flats & Residents', href: '/flats' },
  { id: 'my-flat', label: 'My Flat', href: '/my-flat' },
  { id: 'billing', label: 'Billing', href: '/billing' },
  { id: 'complaints', label: 'Complaints', href: '/complaints' },
  { id: 'gate-management', label: 'Gate Management', href: '/gate-management' },
  { id: 'entry-activity', label: 'Entry Activity', href: '/entry-activity' },
  { id: 'expenses', label: 'Expenses', href: '/expenses' },
  { id: 'assets', label: 'Assets', href: '/assets' },
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
  ADMIN: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'gate-management', 'entry-activity', 'expenses', 'assets', 'reports', 'settings'],
  SECRETARY: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'entry-activity', 'assets', 'reports', 'settings'],
  JOINT_SECRETARY: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'entry-activity', 'assets'],
  TREASURER: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'expenses', 'reports'],
  OWNER: ['dashboard', 'community', 'my-flat', 'billing', 'complaints', 'entry-activity'],
  TENANT: ['dashboard', 'community', 'my-flat', 'billing', 'complaints', 'entry-activity'],
};

const ALLOWED_MENU_IDS_BY_ROLE: Record<ConfigurableMenuRole, NavigationMenuId[]> = {
  ADMIN: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'gate-management', 'entry-activity', 'expenses', 'assets', 'reports', 'settings'],
  SECRETARY: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'gate-management', 'entry-activity', 'expenses', 'assets', 'reports', 'settings'],
  JOINT_SECRETARY: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'gate-management', 'entry-activity', 'expenses', 'assets', 'reports'],
  TREASURER: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'entry-activity', 'expenses', 'reports'],
  OWNER: ['dashboard', 'community', 'my-flat', 'billing', 'complaints', 'entry-activity'],
  TENANT: ['dashboard', 'community', 'my-flat', 'billing', 'complaints', 'entry-activity'],
};

const ROLE_LABELS: Record<ConfigurableMenuRole, string> = {
  ADMIN: 'Admin',
  SECRETARY: 'Secretary',
  JOINT_SECRETARY: 'Joint Secretary',
  TREASURER: 'Treasurer',
  OWNER: 'Owner',
  TENANT: 'Tenant',
};

const LEGACY_MENU_ID_MAP: Partial<Record<string, NavigationMenuId>> = {
  announcements: 'community',
  events: 'community',
};

function normalizeMenuIds(menuIds: readonly string[]): NavigationMenuId[] {
  const normalized = menuIds
    .map((menuId) => LEGACY_MENU_ID_MAP[menuId] || menuId)
    .filter((menuId): menuId is NavigationMenuId => NAVIGATION_MENU_CATALOG.some((item) => item.id === menuId));

  return [...new Set(normalized)];
}

function normalizeRoleMenuVisibilityConfig(roleConfig: RoleMenuVisibilityConfig): RoleMenuVisibilityConfig {
  const visibleMenuIds = normalizeMenuIds(roleConfig.visibleMenuIds);
  const defaultMenuIds = normalizeMenuIds(roleConfig.defaultMenuIds);
  const mandatoryMenuIds = normalizeMenuIds(roleConfig.mandatoryMenuIds);
  const visibleIdSet = new Set(visibleMenuIds);
  const defaultIdSet = new Set(defaultMenuIds);
  const mandatoryIdSet = new Set(mandatoryMenuIds);

  return {
    ...roleConfig,
    visibleMenuIds,
    defaultMenuIds,
    mandatoryMenuIds,
    menuItems: NAVIGATION_MENU_CATALOG.map((item) => ({
      id: item.id,
      label: item.label,
      href: item.href,
      allowed: roleConfig.menuItems.some((menuItem) => (LEGACY_MENU_ID_MAP[menuItem.id] || menuItem.id) === item.id && menuItem.allowed),
      mandatory: mandatoryIdSet.has(item.id),
      enabled: visibleIdSet.has(item.id),
      defaultEnabled: defaultIdSet.has(item.id),
      selectable: roleConfig.menuItems.some((menuItem) => (LEGACY_MENU_ID_MAP[menuItem.id] || menuItem.id) === item.id && menuItem.selectable),
    })),
  };
}

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

  const roleConfig = menuVisibility?.configurableRoles.find((config) => config.role === role);

  return roleConfig
    ? normalizeRoleMenuVisibilityConfig(roleConfig)
    : buildRoleMenuVisibility(role as ConfigurableMenuRole, []);
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