import { Response, Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { getFileUrl, upload } from '../../middleware/upload';
import { ENTRY_ACCESS_ROLES, ENTRY_MANAGE_ROLES, findFlatInSociety, getFlatResidentName, getResidentFlatIds, isAdminWithFlat, isResidentRole } from '../entries/utils';
import { notifyVisitorEntry } from '../notifications/service';

const router = Router();
router.use(authenticate);

const VISITOR_PURPOSES = ['Guest', 'Family Visit', 'Friend Visit', 'Maintenance', 'Official', 'Other'] as const;

function toVisitorResponse(visitor: any) {
  return {
    ...visitor,
    flat: visitor.flat
      ? {
          id: visitor.flat.id,
          flatNumber: visitor.flat.flatNumber,
          block: visitor.flat.block,
          residentName: getFlatResidentName(visitor.flat),
        }
      : null,
  };
}

router.get(
  '/',
  authorize(...ENTRY_ACCESS_ROLES),
  [
    query('status').optional().isIn(['ACTIVE', 'LEFT']),
    query('flatId').optional().isUUID(),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.societyId;
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const where: any = { societyId };
      if (req.query.status) where.status = req.query.status;

      const shouldFilterByFlat = isResidentRole(req.user!.role) || await isAdminWithFlat(req.user!.id, societyId, req.user!.role);

      if (shouldFilterByFlat) {
        const flatIds = await getResidentFlatIds(req.user!.id, societyId);
        if (flatIds.length === 0) return res.json([]);

        where.flatId = req.query.flatId
          ? flatIds.includes(req.query.flatId as string)
            ? req.query.flatId
            : '__forbidden__'
          : { in: flatIds };
      } else if (req.query.flatId) {
        where.flatId = req.query.flatId;
      }

      if (where.flatId === '__forbidden__') {
        return res.json([]);
      }

      const take = Number(req.query.limit || (shouldFilterByFlat ? 5 : 20));

      const visitors = await prisma.visitor.findMany({
        where,
        take,
        orderBy: { checkedInAt: 'desc' },
        include: {
          flat: {
            select: {
              id: true,
              flatNumber: true,
              block: { select: { name: true } },
              owner: { select: { name: true } },
              tenant: { select: { name: true, isActive: true } },
            },
          },
          capturedBy: { select: { name: true } },
        },
      });

      return res.json(visitors.map(toVisitorResponse));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch visitors' });
    }
  },
);

router.post(
  '/',
  authorize(...ENTRY_MANAGE_ROLES),
  upload.single('photo'),
  [
    body('flatId').isUUID(),
    body('visitorName').trim().notEmpty(),
    body('mobile').trim().notEmpty(),
    body('purpose').isIn(VISITOR_PURPOSES),
    body('vehicleNumber').optional({ values: 'falsy' }).isString(),
    body('notes').optional({ values: 'falsy' }).isString(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.societyId;
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const flat = await findFlatInSociety(req.body.flatId, societyId);
      if (!flat) return res.status(404).json({ error: 'Flat not found in your society' });

      const visitor = await prisma.visitor.create({
        data: {
          societyId,
          flatId: req.body.flatId,
          capturedByUserId: req.user!.id,
          visitorName: req.body.visitorName,
          mobile: req.body.mobile,
          vehicleNumber: req.body.vehicleNumber || null,
          purpose: req.body.purpose,
          notes: req.body.notes || null,
          photoUrl: req.file ? getFileUrl(req.file) : null,
        },
        include: {
          flat: {
            select: {
              id: true,
              flatNumber: true,
              block: { select: { name: true } },
              owner: { select: { name: true } },
              tenant: { select: { name: true, isActive: true } },
            },
          },
          capturedBy: { select: { name: true } },
        },
      });

      notifyVisitorEntry(visitor.id).catch(() => {});

      return res.status(201).json(toVisitorResponse(visitor));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create visitor' });
    }
  },
);

router.patch(
  '/:id/checkout',
  authorize(...ENTRY_MANAGE_ROLES),
  [
    param('id').isUUID(),
    body('checkedOutAt').optional().isISO8601(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.societyId;
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const existing = await prisma.visitor.findFirst({
        where: { id: req.params.id, societyId },
      });

      if (!existing) return res.status(404).json({ error: 'Visitor not found' });
      if (existing.status === 'LEFT') return res.status(400).json({ error: 'Visitor already marked as left' });

      const visitor = await prisma.visitor.update({
        where: { id: req.params.id },
        data: {
          status: 'LEFT',
          checkedOutAt: req.body.checkedOutAt ? new Date(req.body.checkedOutAt) : new Date(),
        },
        include: {
          flat: {
            select: {
              id: true,
              flatNumber: true,
              block: { select: { name: true } },
              owner: { select: { name: true } },
              tenant: { select: { name: true, isActive: true } },
            },
          },
          capturedBy: { select: { name: true } },
        },
      });

      return res.json(toVisitorResponse(visitor));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update visitor status' });
    }
  },
);

export default router;