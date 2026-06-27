import { AuthRequest } from '../../middleware/auth';

export function resolveNotificationSocietyId(req: AuthRequest) {
  return req.user!.role === 'SUPER_ADMIN'
    ? req.body.societyId || req.user!.societyId
    : req.user!.societyId;
}