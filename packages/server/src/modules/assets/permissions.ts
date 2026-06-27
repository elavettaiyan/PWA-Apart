import { AuthRequest } from '../../middleware/auth';

type AuthUser = NonNullable<AuthRequest['user']>;

export const canAccessSocietyRecord = (user: AuthUser, record: { societyId: string }): boolean => {
  return user.role === 'SUPER_ADMIN' || record.societyId === user.societyId;
};