import { Response, Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest, SOCIETY_MANAGERS, RESIDENT_ROLES } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { upload, getFileUrl } from '../../middleware/upload';
import { notifyNewComplaint } from '../notifications/service';

const router = Router();
router.use(authenticate);

const COMPLAINT_CATEGORY_BY_SPECIALIZATION: Record<string, string> = {
  Plumber: 'Plumbing',
  Electrician: 'Electrical',
  Cleaner: 'Cleaning',
  'Lift Operator': 'Lift',
  Carpenter: 'Civil',
  Security: 'Security',
};

/** Parse the images JSON string into an actual array */
function parseImages(complaint: any) {
  if (!complaint) return complaint;
  try {
    complaint.images = typeof complaint.images === 'string' ? JSON.parse(complaint.images) : (complaint.images || []);
  } catch {
    complaint.images = [];
  }
  return complaint;
}

// ── GET ALL COMPLAINTS ──────────────────────────────────
router.get(
  '/',
  [
    query('status').optional().isIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REJECTED']),
    query('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
    query('category').optional().isString(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const where: any = {};
      let serviceStaffCategory = '';

      if (req.query.status) where.status = req.query.status;
      if (req.query.priority) where.priority = req.query.priority;
      if (req.query.category) where.category = req.query.category;

      // Restrict to user's society
      if (req.user!.societyId) where.societyId = req.user!.societyId;

      // Non-manager: only their own complaints or assigned complaints
      if ([...RESIDENT_ROLES, 'TREASURER'].includes(req.user!.role as any)) {
        where.createdById = req.user!.id;
      } else if (req.user!.role === 'SERVICE_STAFF') {
        const serviceStaffUser = await prisma.user.findUnique({
          where: { id: req.user!.id },
          select: { specialization: true },
        });

        if (!req.query.category) {
          serviceStaffCategory = COMPLAINT_CATEGORY_BY_SPECIALIZATION[serviceStaffUser?.specialization || ''] || '';
        }

        where.OR = [
          { assignedToId: req.user!.id },
          { createdById: req.user!.id },
          ...(serviceStaffCategory ? [{ category: serviceStaffCategory }] : []),
        ];
      }

      const complaints = await prisma.complaint.findMany({
        where,
        include: {
          flat: { select: { flatNumber: true, block: { select: { name: true } } } },
          createdBy: { select: { name: true } },
          assignedTo: { select: { name: true } },
          _count: { select: { comments: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.json(complaints.map(parseImages));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch complaints' });
    }
  },
);

// ── GET SINGLE COMPLAINT ────────────────────────────────
router.get('/:id', [param('id').isUUID()], validate, async (req: AuthRequest, res: Response) => {
  try {
    const complaint = await prisma.complaint.findUnique({
      where: { id: req.params.id },
      include: {
        flat: { include: { block: true } },
        createdBy: { select: { name: true, email: true } },
        assignedTo: { select: { name: true, email: true } },
        comments: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });

    // SECURITY: Verify complaint belongs to user's society
    if (req.user!.role !== 'SUPER_ADMIN' && complaint.societyId !== req.user!.societyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.json(parseImages(complaint));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch complaint' });
  }
});

// ── CREATE COMPLAINT ────────────────────────────────────
router.post(
  '/',
  upload.array('images', 2),
  [
    body('title').trim().notEmpty(),
    body('description').trim().notEmpty(),
    body('category').trim().notEmpty(),
    body('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
    body('flatId').optional().isUUID(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // Validate each image is under 2 MB
      const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2 MB
      const files = (req.files as Express.Multer.File[]) || [];
      for (const f of files) {
        if (f.size > MAX_IMAGE_SIZE) {
          return res.status(400).json({ error: `Each image must be under 2 MB. "${f.originalname}" is too large.` });
        }
      }

      const imageList = files.map((f) => getFileUrl(f));

      const complaint = await prisma.complaint.create({
        data: {
          societyId: req.user!.societyId!,
          flatId: req.body.flatId || null,
          createdById: req.user!.id,
          title: req.body.title,
          description: req.body.description,
          category: req.body.category,
          priority: req.body.priority || 'MEDIUM',
          images: JSON.stringify(imageList),
        },
        include: {
          flat: { select: { flatNumber: true } },
          createdBy: { select: { name: true } },
        },
      });

      notifyNewComplaint(complaint.id).catch(() => {});

      return res.status(201).json(parseImages(complaint));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create complaint' });
    }
  },
);

// ── UPDATE COMPLAINT STATUS ─────────────────────────────
router.patch(
  '/:id/status',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS, 'SERVICE_STAFF'),
  [
    param('id').isUUID(),
    body('status').isIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REJECTED']),
    body('assignedToId').optional().isUUID(),
    body('resolution').optional().isString(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // SECURITY: Verify complaint belongs to admin's society
      const existing = await prisma.complaint.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Complaint not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && existing.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // SERVICE_STAFF can only update complaints assigned to them
      if (req.user!.role === 'SERVICE_STAFF' && existing.assignedToId !== req.user!.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const data: any = { status: req.body.status };

      if (req.body.assignedToId) data.assignedToId = req.body.assignedToId;
      if (req.body.resolution) data.resolution = req.body.resolution;
      if (req.body.status === 'RESOLVED' || req.body.status === 'CLOSED') {
        data.resolvedAt = new Date();
      }

      const complaint = await prisma.complaint.update({
        where: { id: req.params.id },
        data,
        include: {
          createdBy: { select: { name: true } },
          assignedTo: { select: { name: true } },
        },
      });

      return res.json(parseImages(complaint));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update complaint' });
    }
  },
);

// ── ADD COMMENT ─────────────────────────────────────────
router.post(
  '/:id/comments',
  [param('id').isUUID(), body('content').trim().notEmpty()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // SECURITY: Verify complaint belongs to user's society
      const complaint = await prisma.complaint.findUnique({ where: { id: req.params.id } });
      if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && complaint.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { name: true },
      });

      const comment = await prisma.complaintComment.create({
        data: {
          complaintId: req.params.id,
          authorName: user!.name,
          content: req.body.content,
        },
      });

      return res.status(201).json(comment);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to add comment' });
    }
  },
);

export default router;
