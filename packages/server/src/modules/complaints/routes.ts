import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { upload } from '../../middleware/upload';

const router = Router();
router.use(authenticate);

// ── GET ALL COMPLAINTS ──────────────────────────────────
router.get(
  '/',
  [
    query('status').optional().isIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REJECTED']),
    query('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
    query('category').optional().isString(),
  ],
  validate,
  async (req: AuthRequest, res) => {
    try {
      const where: any = {};

      if (req.query.status) where.status = req.query.status;
      if (req.query.priority) where.priority = req.query.priority;
      if (req.query.category) where.category = req.query.category;

      // Restrict to user's society
      if (req.user!.societyId) where.societyId = req.user!.societyId;

      // Non-admin: only their own complaints
      if (req.user!.role === 'OWNER' || req.user!.role === 'TENANT') {
        where.createdById = req.user!.id;
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

      return res.json(complaints);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch complaints' });
    }
  },
);

// ── GET SINGLE COMPLAINT ────────────────────────────────
router.get('/:id', [param('id').isUUID()], validate, async (req: AuthRequest, res) => {
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

    return res.json(complaint);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch complaint' });
  }
});

// ── CREATE COMPLAINT ────────────────────────────────────
router.post(
  '/',
  upload.array('images', 5),
  [
    body('title').trim().notEmpty(),
    body('description').trim().notEmpty(),
    body('category').trim().notEmpty(),
    body('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
    body('flatId').optional().isUUID(),
  ],
  validate,
  async (req: AuthRequest, res) => {
    try {
      const imageList = (req.files as Express.Multer.File[])?.map(
        (f) => `/uploads/${f.filename}`,
      ) || [];

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

      return res.status(201).json(complaint);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create complaint' });
    }
  },
);

// ── UPDATE COMPLAINT STATUS ─────────────────────────────
router.patch(
  '/:id/status',
  authorize('SUPER_ADMIN', 'ADMIN'),
  [
    param('id').isUUID(),
    body('status').isIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REJECTED']),
    body('assignedToId').optional().isUUID(),
    body('resolution').optional().isString(),
  ],
  validate,
  async (req: AuthRequest, res) => {
    try {
      // SECURITY: Verify complaint belongs to admin's society
      const existing = await prisma.complaint.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Complaint not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && existing.societyId !== req.user!.societyId) {
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

      return res.json(complaint);
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
  async (req: AuthRequest, res) => {
    try {
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
