import { Response, Router } from 'express';
import { ApprovalActionType, ApprovalStatus } from '@prisma/client';
import { authenticate, authorize, AuthRequest, SOCIETY_MANAGERS } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import logger from '../../config/logger';
import { sendOk } from '../../lib/http';
import { COMMUNITY_READ_ITEM_TYPES, setCommunityItemReadState } from '../communityReadState/service';
import {
  approveApprovalRequest,
  getApprovalConfig,
  getApprovalRequestById,
  listApprovalRequests,
  rejectApprovalRequest,
  upsertApprovalConfig,
} from './service';
import { resolveSocietyId } from './permissions';
import {
  approvalConfigValidation,
  approvalIdValidation,
  approvalReadStateValidation,
  listApprovalsValidation,
  resolveApprovalValidation,
  updateApprovalConfigValidation,
} from './validation';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  listApprovalsValidation,
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

      return sendOk(res, requests);
    } catch (error: any) {
      logger.error('Failed to list approval requests', { error: error.message, userId: req.user?.id });
      return res.status(500).json({ error: 'Failed to fetch approval requests' });
    }
  },
);

router.get(
  '/config/:actionType',
  approvalConfigValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = resolveSocietyId(req, req.query.societyId as string | undefined);
      if (!societyId) {
        return res.status(400).json({ error: 'Society ID required' });
      }

      return sendOk(res, await getApprovalConfig(societyId, req.params.actionType as ApprovalActionType));
    } catch (error: any) {
      logger.error('Failed to fetch approval config', { error: error.message, userId: req.user?.id });
      return res.status(500).json({ error: 'Failed to fetch approval config' });
    }
  },
);

router.get(
  '/:id',
  approvalIdValidation,
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

      return sendOk(res, request);
    } catch (error: any) {
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ error: 'Access denied' });
      }
      logger.error('Failed to fetch approval request', { error: error.message, requestId: req.params.id, userId: req.user?.id });
      return res.status(500).json({ error: 'Failed to fetch approval request' });
    }
  },
);

router.patch(
  '/:id/read-state',
  approvalReadStateValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = resolveSocietyId(req, req.query.societyId as string | undefined);
      if (!societyId || !req.user?.id) {
        return res.status(400).json({ error: 'Society ID required' });
      }

      const existing = await getApprovalRequestById({
        requestId: req.params.id,
        societyId,
        userId: req.user.id,
        userRole: req.user.role,
      });

      if (!existing) {
        return res.status(404).json({ error: 'Approval request not found' });
      }

      if (existing.status === 'PENDING') {
        return res.status(400).json({ error: 'Pending approvals stay in Inbox until reviewed' });
      }

      await setCommunityItemReadState({
        itemType: COMMUNITY_READ_ITEM_TYPES.APPROVAL,
        itemId: existing.id,
        userId: req.user.id,
        isRead: req.body.isRead,
      });

      const updated = await getApprovalRequestById({
        requestId: req.params.id,
        societyId,
        userId: req.user.id,
        userRole: req.user.role,
      });

      return sendOk(res, updated);
    } catch (error: any) {
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ error: 'Not allowed to view this approval request' });
      }

      logger.error('Failed to update approval read state', { error: error.message, userId: req.user?.id, approvalId: req.params.id });
      return res.status(500).json({ error: 'Failed to update approval read state' });
    }
  },
);

router.put(
  '/config/:actionType',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  updateApprovalConfigValidation,
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

      return sendOk(res, config);
    } catch (error: any) {
      logger.error('Failed to update approval config', { error: error.message, userId: req.user?.id });
      return res.status(500).json({ error: 'Failed to update approval config' });
    }
  },
);

router.patch(
  '/:id/approve',
  resolveApprovalValidation,
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

      return sendOk(res, request);
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
  resolveApprovalValidation,
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

      return sendOk(res, request);
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
