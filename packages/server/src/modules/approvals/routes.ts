import { Response, Router } from 'express';
import { body, param, query } from 'express-validator';
import { ApprovalActionType, ApprovalStatus } from '@prisma/client';
import { authenticate, authorize, AuthRequest, ALL_SOCIETY_ROLES, SOCIETY_MANAGERS } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import logger from '../../config/logger';
import {
  approveApprovalRequest,
  getApprovalConfig,
  getApprovalRequestById,
  listApprovalRequests,
  rejectApprovalRequest,
  upsertApprovalConfig,
} from './service';

const router = Router();
const APPROVAL_ACTION_TYPES: ApprovalActionType[] = ['TENANT_REGISTRATION', 'TENANT_PROFILE_CHANGE'];
const APPROVAL_STATUSES: ApprovalStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

router.use(authenticate);

function resolveSocietyId(req: AuthRequest, providedSocietyId?: string) {
  if (req.user?.role === 'SUPER_ADMIN') {
    return providedSocietyId || req.user.activeSocietyId || req.user.societyId || null;
  }

  return req.user?.activeSocietyId || req.user?.societyId || null;
}

router.get(
  '/',
  [
    query('societyId').optional().isUUID(),
    query('status').optional().isIn(APPROVAL_STATUSES),
    query('actionType').optional().isIn(APPROVAL_ACTION_TYPES),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = resolveSocietyId(req, req.query.societyId as string | undefined);
      if (!societyId) {
        return res.status(400).json({ error: 'Society ID required' });
      }

      const requests = await listApprovalRequests({
        societyId,
        userId: req.user!.id,
        userRole: req.user!.role,
        status: req.query.status as ApprovalStatus | undefined,
        actionType: req.query.actionType as ApprovalActionType | undefined,
      });

      return res.json(requests);
    } catch (error: any) {
      logger.error('Failed to list approval requests', { error: error.message, userId: req.user?.id });
      return res.status(500).json({ error: 'Failed to fetch approval requests' });
    }
  },
);

router.get(
  '/config/:actionType',
  [param('actionType').isIn(APPROVAL_ACTION_TYPES), query('societyId').optional().isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = resolveSocietyId(req, req.query.societyId as string | undefined);
      if (!societyId) {
        return res.status(400).json({ error: 'Society ID required' });
      }

      return res.json(await getApprovalConfig(societyId, req.params.actionType as ApprovalActionType));
    } catch (error: any) {
      logger.error('Failed to fetch approval config', { error: error.message, userId: req.user?.id });
      return res.status(500).json({ error: 'Failed to fetch approval config' });
    }
  },
);

router.get(
  '/:id',
  [param('id').isUUID(), query('societyId').optional().isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = resolveSocietyId(req, req.query.societyId as string | undefined);
      if (!societyId) {
        return res.status(400).json({ error: 'Society ID required' });
      }

      const request = await getApprovalRequestById({
        requestId: req.params.id,
        societyId,
        userId: req.user!.id,
        userRole: req.user!.role,
      });

      if (!request) {
        return res.status(404).json({ error: 'Approval request not found' });
      }

      return res.json(request);
    } catch (error: any) {
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ error: 'Access denied' });
      }
      logger.error('Failed to fetch approval request', { error: error.message, requestId: req.params.id, userId: req.user?.id });
      return res.status(500).json({ error: 'Failed to fetch approval request' });
    }
  },
);

router.put(
  '/config/:actionType',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [
    param('actionType').isIn(APPROVAL_ACTION_TYPES),
    body('societyId').optional().isUUID(),
    body('enabled').isBoolean().withMessage('enabled must be a boolean'),
    body('approverRoles').optional().isArray().withMessage('approverRoles must be an array'),
    body('approverRoles.*').optional().isIn([...ALL_SOCIETY_ROLES]).withMessage('Invalid approver role'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = resolveSocietyId(req, req.body.societyId);
      if (!societyId) {
        return res.status(400).json({ error: 'Society ID required' });
      }

      const config = await upsertApprovalConfig({
        societyId,
        actionType: req.params.actionType as ApprovalActionType,
        enabled: Boolean(req.body.enabled),
        approverRoles: req.body.approverRoles,
      });

      return res.json(config);
    } catch (error: any) {
      logger.error('Failed to update approval config', { error: error.message, userId: req.user?.id });
      return res.status(500).json({ error: 'Failed to update approval config' });
    }
  },
);

router.patch(
  '/:id/approve',
  [
    param('id').isUUID(),
    body('societyId').optional().isUUID(),
    body('comment').optional({ values: 'falsy' }).trim().isLength({ max: 500 }).withMessage('Comment is too long'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = resolveSocietyId(req, req.body.societyId);
      if (!societyId) {
        return res.status(400).json({ error: 'Society ID required' });
      }

      const request = await approveApprovalRequest({
        requestId: req.params.id,
        societyId,
        actorId: req.user!.id,
        actorRole: req.user!.role,
        actorName: req.user!.email,
        comment: req.body.comment,
      });

      return res.json(request);
    } catch (error: any) {
      if (error.message === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Approval request not found' });
      }
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ error: 'Access denied' });
      }
      if (error.message === 'APPROVAL_NOT_PENDING') {
        return res.status(409).json({ error: 'Approval request is no longer pending' });
      }
      if (error.message === 'ACTIVE_TENANT_EXISTS') {
        return res.status(409).json({ error: 'This flat already has an active tenant' });
      }
      logger.error('Failed to approve request', { error: error.message, requestId: req.params.id, userId: req.user?.id });
      return res.status(500).json({ error: 'Failed to approve request' });
    }
  },
);

router.patch(
  '/:id/reject',
  [
    param('id').isUUID(),
    body('societyId').optional().isUUID(),
    body('comment').optional({ values: 'falsy' }).trim().isLength({ max: 500 }).withMessage('Comment is too long'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = resolveSocietyId(req, req.body.societyId);
      if (!societyId) {
        return res.status(400).json({ error: 'Society ID required' });
      }

      const request = await rejectApprovalRequest({
        requestId: req.params.id,
        societyId,
        actorId: req.user!.id,
        actorRole: req.user!.role,
        actorName: req.user!.email,
        comment: req.body.comment,
      });

      return res.json(request);
    } catch (error: any) {
      if (error.message === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Approval request not found' });
      }
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ error: 'Access denied' });
      }
      if (error.message === 'APPROVAL_NOT_PENDING') {
        return res.status(409).json({ error: 'Approval request is no longer pending' });
      }
      logger.error('Failed to reject request', { error: error.message, requestId: req.params.id, userId: req.user?.id });
      return res.status(500).json({ error: 'Failed to reject request' });
    }
  },
);

export default router;
