import { AuthRequest } from '../../middleware/auth';

export function resolveReportSocietyId(req: AuthRequest) {
  return req.user!.role === 'SUPER_ADMIN'
    ? (req.query.societyId as string) || req.user!.societyId
    : req.user!.societyId;
}