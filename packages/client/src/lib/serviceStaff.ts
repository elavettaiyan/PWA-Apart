import type { User } from '../types';

const SECURITY_SPECIALIZATION = 'Security';

const COMPLAINT_CATEGORY_BY_SPECIALIZATION: Record<string, string> = {
  Plumbing: 'Plumbing',
  Plumber: 'Plumbing',
  Electrical: 'Electrical',
  Electrician: 'Electrical',
  Civil: 'Civil',
  Lift: 'Lift',
  Cleaning: 'Cleaning',
  Gardening: 'Gardening',
  Security: 'Security',
  Other: 'Other',
  Cleaner: 'Cleaning',
  'Lift Operator': 'Lift',
  Carpenter: 'Civil',
  Gardener: 'Gardening',
};

export const SERVICE_STAFF_SPECIALIZATIONS = [
  'Plumbing',
  'Electrical',
  'Civil',
  'Lift',
  'Security',
  'Cleaning',
  'Gardening',
  'Other',
] as const;

export const COMPLAINT_CATEGORIES = [...SERVICE_STAFF_SPECIALIZATIONS] as const;

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

  return getComplaintCategoryForSpecialization(user.specialization);
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

export function getComplaintCategoryForSpecialization(specialization?: string | null) {
  return COMPLAINT_CATEGORY_BY_SPECIALIZATION[specialization || ''] || '';
}