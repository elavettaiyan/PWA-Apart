import { AuthRequest } from '../../middleware/auth';

type AuthUser = NonNullable<AuthRequest['user']>;

export const canAccessExpense = (user: AuthUser, expense: { societyId: string }): boolean => {
  return user.role === 'SUPER_ADMIN' || expense.societyId === user.societyId;
};