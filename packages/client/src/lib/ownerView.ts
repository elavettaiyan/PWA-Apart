import type { User } from '../types';

export type AppViewMode = 'ADMIN_VIEW' | 'OWNER_VIEW';

const OWNER_VIEW_ROLES = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER'];

export function canUseOwnerView(user?: User | null) {
  return Boolean(user?.role && OWNER_VIEW_ROLES.includes(user.role) && user.canUseOwnerView);
}

export function getDefaultViewMode(user?: User | null): AppViewMode {
  return canUseOwnerView(user) ? 'OWNER_VIEW' : 'ADMIN_VIEW';
}

export function normalizeViewMode(user: User | null, requestedMode?: AppViewMode): AppViewMode {
  if (!canUseOwnerView(user)) {
    return 'ADMIN_VIEW';
  }

  return requestedMode || 'OWNER_VIEW';
}

export function isOwnerViewActive(user?: User | null, viewMode?: AppViewMode) {
  return canUseOwnerView(user) && viewMode === 'OWNER_VIEW';
}

export function getDisplayUserForView(user: User | null, viewMode?: AppViewMode): User | null {
  if (!user) {
    return null;
  }

  if (isOwnerViewActive(user, viewMode)) {
    return { ...user, role: 'OWNER' };
  }

  return user;
}

export function getRoleDisplayLabel(user?: User | null, viewMode?: AppViewMode) {
  if (!user?.role) {
    return '';
  }

  const roleLabel = user.role.replace('_', ' ');
  return isOwnerViewActive(user, viewMode) ? `${roleLabel} (Owner View)` : roleLabel;
}

export function getRoleViewLabel(user?: User | null) {
  if (!user?.role) {
    return 'Role View';
  }

  const roleLabel = user.role
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');

  return `${roleLabel} View`;
}