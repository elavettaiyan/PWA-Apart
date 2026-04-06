import { Response, Router } from 'express';
import { body, query } from 'express-validator';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { getFileUrl, upload } from '../../middleware/upload';
import { ENTRY_ACCESS_ROLES, ENTRY_MANAGE_ROLES, findFlatInSociety, getFlatResidentName, getResidentFlatIds, isAdminWithFlat, isResidentRole } from '../entries/utils';
import { notifyDeliveryAlert } from '../notifications/service';

const router = Router();
router.use(authenticate);

function toDeliveryResponse(delivery: any) {
  return {
    ...delivery,
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
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.societyId;
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const where: any = { societyId };
      if (req.query.deliveryType) where.deliveryType = req.query.deliveryType;

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

      return res.json(deliveries.map(toDeliveryResponse));
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

      return res.status(201).json(toDeliveryResponse(delivery));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create delivery' });
    }
  },
);

export default router;