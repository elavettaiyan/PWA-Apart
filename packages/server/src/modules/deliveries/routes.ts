import { Response, Router } from 'express';
import { authenticate, authorize, AuthRequest } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { getFileUrl, upload } from '../../middleware/upload';
import { sendCreated, sendOk } from '../../lib/http';
import { ENTRY_ACCESS_ROLES, ENTRY_MANAGE_ROLES } from '../entries/utils';
import { notifyDeliveryAlert } from '../notifications/service';
import { canReadDelivery, createDelivery, findDeliveryForReadState, listDeliveries, updateDeliveryReadState } from './service';
import { createDeliveryValidation, listDeliveriesValidation, updateDeliveryReadStateValidation } from './validation';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  authorize(...ENTRY_ACCESS_ROLES),
  listDeliveriesValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.societyId;
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const deliveries = await listDeliveries({
        societyId,
        userId: req.user!.id,
        role: req.user!.role,
        query: req.query,
      });

      return sendOk(res, deliveries);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch deliveries' });
    }
  },
);

router.post(
  '/',
  authorize(...ENTRY_MANAGE_ROLES),
  upload.single('photo'),
  createDeliveryValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.societyId;
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const delivery = await createDelivery({
        societyId,
        userId: req.user!.id,
        body: req.body,
        photoUrl: req.file ? getFileUrl(req.file) : null,
      });
      if (!delivery) return res.status(404).json({ error: 'Flat not found in your society' });

      notifyDeliveryAlert(delivery.id).catch(() => {});

      return sendCreated(res, delivery);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create delivery' });
    }
  },
);

router.patch(
  '/:id/read-state',
  updateDeliveryReadStateValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user?.activeSocietyId || req.user?.societyId;
      if (!societyId || !req.user?.id) {
        return res.status(400).json({ error: 'Society ID required' });
      }

      const delivery = await findDeliveryForReadState(req.params.id, societyId);

      if (!delivery) {
        return res.status(404).json({ error: 'Delivery not found' });
      }

      const canRead = await canReadDelivery({
        userId: req.user.id,
        societyId,
        role: req.user.role,
        deliveryFlatId: delivery.flatId,
        ownerViewRequested: req.query.ownerView === 'true',
      });

      if (!canRead) {
        return res.status(403).json({ error: 'Not allowed to view this delivery' });
      }

      const result = await updateDeliveryReadState({
        delivery,
        userId: req.user.id,
        isRead: req.body.isRead,
      });

      return sendOk(res, result);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update delivery read state' });
    }
  },
);

export default router;