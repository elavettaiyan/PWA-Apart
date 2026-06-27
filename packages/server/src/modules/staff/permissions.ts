import { AuthRequest } from '../../middleware/auth';

export const getRequiredSocietyId = (req: AuthRequest): string | null => {
  return req.user?.societyId || null;
};