import type { User } from '../types';

const SECURITY_SPECIALIZATION = 'Security';

const COMPLAINT_CATEGORY_BY_SPECIALIZATION: Record<string, string> = {
  Plumber: 'Plumbing',
  Electrician: 'Electrical',
  Cleaner: 'Cleaning',
  'Lift Operator': 'Lift',
  Security: 'Security',
  Carpenter: 'Civil',
  Gardener: 'Other',
  Other: 'Other',
};

export function isSecurityServiceStaff(user?: User | null) {
  return user?.role === 'SERVICE_STAFF' && user.specialization === SECURITY_SPECIALIZATION;
}

export function isNonSecurityServiceStaff(user?: User | null) {
  return user?.role === 'SERVICE_STAFF' && !isSecurityServiceStaff(user);
}

export function getDefaultComplaintCategoryForUser(user?: User | null) {
  if (!isNonSecurityServiceStaff(user) || !user?.specialization) {
    return '';
  }

  return COMPLAINT_CATEGORY_BY_SPECIALIZATION[user.specialization] || '';
}

export function getDefaultAuthenticatedRoute(user?: User | null) {
  if (isSecurityServiceStaff(user)) {
    return '/gate-management';
  }

  if (user?.role === 'SERVICE_STAFF') {
    return '/complaints';
  }

  return '/';
}

export function shouldSelectSocietyOnLogin(user?: User | null) {
  return (user?.societies?.length || 0) > 1;
}

export function getPostLoginRoute(user?: User | null) {
  if (shouldSelectSocietyOnLogin(user)) {
    return '/select-society';
  }

  return getDefaultAuthenticatedRoute(user);
}