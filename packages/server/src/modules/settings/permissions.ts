import { AuthRequest } from '../../middleware/auth';

export function resolveSettingsSocietyId(req: AuthRequest, providedSocietyId?: string) {
  if (req.user?.role === 'SUPER_ADMIN') {
    return providedSocietyId || req.user.societyId || null;
  }

  return req.user?.societyId || null;
}