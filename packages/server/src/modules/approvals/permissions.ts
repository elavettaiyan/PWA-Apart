import { AuthRequest } from '../../middleware/auth';

export function resolveSocietyId(req: AuthRequest, providedSocietyId?: string) {
  if (req.user?.role === 'SUPER_ADMIN') {
    return providedSocietyId || req.user.activeSocietyId || req.user.societyId || null;
  }

  return req.user?.activeSocietyId || req.user?.societyId || null;
}