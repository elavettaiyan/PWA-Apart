import { AuthRequest } from '../../middleware/auth';

type AuthUser = NonNullable<AuthRequest['user']>;

export const canAccessBylaw = (user: AuthUser, bylaw: { societyId: string | null }): boolean => {
  return user.role === 'SUPER_ADMIN' || bylaw.societyId === user.societyId;
};