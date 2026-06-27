import { AuthRequest } from '../../middleware/auth';

export function getSocietyId(req: AuthRequest) {
  return req.user!.role === 'SUPER_ADMIN'
    ? (req.query.societyId as string) || req.body.societyId || req.user!.societyId
    : req.user!.societyId;
}