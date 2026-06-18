import { Response, Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { getFileUrl, upload } from '../../middleware/upload';
import { COMMUNITY_READ_ITEM_TYPES, getCommunityItemReadStateMap, setCommunityItemReadState } from '../communityReadState/service';
import { ENTRY_ACCESS_ROLES, ENTRY_MANAGE_ROLES, findFlatInSociety, getFlatResidentName, getOwnedFlatIds, getResidentFlatIds, isResidentRole } from '../entries/utils';
import { notifyDeliveryAlert } from '../notifications/service';

const router = Router();
router.use(authenticate);

function toDeliveryResponse(delivery: any, readAt?: Date | null) {
  return {
    ...delivery,
    isRead: Boolean(readAt),
    readAt: readAt ? readAt.toISOString() : null,
    flat: delivery.flat
      ? {
          id: delivery.flat.id,
          flatNumber: delivery.flat.flatNumber,
          block: delivery.flat.block,
          residentName: getFlatResidentName(delivery.flat),
        }
      : null,
  };
}

router.get(
  '/',
  authorize(...ENTRY_ACCESS_ROLES),
  [
    query('deliveryType').optional().isIn(['COURIER', 'FOOD', 'GROCERY', 'MEDICINE', 'PARCEL', 'OTHER']),
    query('flatId').optional().isUUID(),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('ownerView').optional().isBoolean(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.societyId;
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const where: any = { societyId };
      if (req.query.deliveryType) where.deliveryType = req.query.deliveryType;

      const ownerViewRequested = req.query.ownerView === 'true';
      const isHigherRoleOwnerView = ownerViewRequested && ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER'].includes(req.user!.role);
      const shouldFilterByFlat = isResidentRole(req.user!.role) || isHigherRoleOwnerView;

      if (shouldFilterByFlat) {
        const flatIds = isHigherRoleOwnerView
          ? await getOwnedFlatIds(req.user!.id, societyId)
          : await getResidentFlatIds(req.user!.id, societyId);
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

      const deliveries = await prisma.delivery.findMany({
        where,
        take,
        orderBy: { deliveredAt: 'desc' },
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

      const deliveryReadStateMap = await getCommunityItemReadStateMap({
        itemType: COMMUNITY_READ_ITEM_TYPES.DELIVERY,
        userId: req.user!.id,
        itemIds: deliveries.map((delivery) => delivery.id),
      });

      return res.json(deliveries.map((delivery) => toDeliveryResponse(delivery, deliveryReadStateMap.get(delivery.id) || null)));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch deliveries' });
    }
  },
);

router.post(
  '/',
  authorize(...ENTRY_MANAGE_ROLES),
  upload.single('photo'),
  [
    body('flatId').isUUID(),
    body('deliveryType').isIn(['COURIER', 'FOOD', 'GROCERY', 'MEDICINE', 'PARCEL', 'OTHER']),
    body('deliveryPersonName').trim().notEmpty(),
    body('mobile').trim().notEmpty(),
    body('companyName').optional({ values: 'falsy' }).isString(),
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

      const delivery = await prisma.delivery.create({
        data: {
          societyId,
          flatId: req.body.flatId,
          capturedByUserId: req.user!.id,
          deliveryType: req.body.deliveryType,
          deliveryPersonName: req.body.deliveryPersonName,
          mobile: req.body.mobile || null,
          companyName: req.body.companyName || null,
          vehicleNumber: req.body.vehicleNumber || null,
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

      notifyDeliveryAlert(delivery.id).catch(() => {});

      return res.status(201).json(toDeliveryResponse(delivery, null));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create delivery' });
    }
  },
);

router.patch(
  '/:id/read-state',
  [param('id').isUUID(), body('isRead').isBoolean().withMessage('isRead must be a boolean')],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user?.activeSocietyId || req.user?.societyId;
      if (!societyId || !req.user?.id) {
        return res.status(400).json({ error: 'Society ID required' });
      }

      const delivery = await prisma.delivery.findFirst({
        where: {
          id: req.params.id,
          societyId,
        },
        include: {
          flat: {
            select: {
              id: true,
              flatNumber: true,
              block: { select: { name: true } },
              owner: { select: { name: true, userId: true } },
              tenant: { select: { name: true, userId: true, isActive: true } },
            },
          },
          capturedBy: { select: { name: true } },
        },
      });

      if (!delivery) {
        return res.status(404).json({ error: 'Delivery not found' });
      }

      const ownerViewRequested = req.query.ownerView === 'true';
      const isHigherRoleOwnerView = ownerViewRequested && ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER'].includes(req.user.role);
      const shouldFilterByFlat = isResidentRole(req.user.role) || isHigherRoleOwnerView;

      if (shouldFilterByFlat) {
        const flatIds = isHigherRoleOwnerView
          ? await getOwnedFlatIds(req.user.id, societyId)
          : await getResidentFlatIds(req.user.id, societyId);

        if (!flatIds.includes(delivery.flatId)) {
          return res.status(403).json({ error: 'Not allowed to view this delivery' });
        }
      }

      await setCommunityItemReadState({
        itemType: COMMUNITY_READ_ITEM_TYPES.DELIVERY,
        itemId: delivery.id,
        userId: req.user.id,
        isRead: req.body.isRead,
      });

      const readStateMap = await getCommunityItemReadStateMap({
        itemType: COMMUNITY_READ_ITEM_TYPES.DELIVERY,
        userId: req.user.id,
        itemIds: [delivery.id],
      });

      return res.json(toDeliveryResponse(delivery, readStateMap.get(delivery.id) || null));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update delivery read state' });
    }
  },
);

export default router;