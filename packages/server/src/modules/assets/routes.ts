import { Response, Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest, SOCIETY_MANAGERS } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { upload, getFileUrl } from '../../middleware/upload';
import { sendPushToSocietyRoles } from '../notifications/service';

const router = Router();
router.use(authenticate);

const ASSET_TYPES = ['LIFT', 'WATER_TANK', 'TOILET', 'AUDITORIUM', 'SEPTIC_TANK', 'GARDEN', 'GENERATOR', 'PUMP', 'FIRE_SAFETY', 'OTHER'] as const;
const SERVICE_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'CUSTOM'] as const;
const JOB_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'POSTPONED', 'RESCHEDULED'] as const;
const JOB_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2 MB

function parseImages(record: any) {
  if (!record) return record;
  try {
    record.images = typeof record.images === 'string' ? JSON.parse(record.images) : (record.images || []);
  } catch {
    record.images = [];
  }
  return record;
}

// ── DASHBOARD STATS ─────────────────────────────────────
router.get(
  '/dashboard',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.societyId!;

      const [totalAssets, activeAssets, overdueJobs, pendingJobs, completedThisMonth] = await Promise.all([
        prisma.asset.count({ where: { societyId } }),
        prisma.asset.count({ where: { societyId, isActive: true } }),
        prisma.serviceJob.count({
          where: { societyId, status: { in: ['PENDING', 'IN_PROGRESS'] }, scheduledDate: { lt: new Date() } },
        }),
        prisma.serviceJob.count({
          where: { societyId, status: 'PENDING' },
        }),
        prisma.serviceJob.count({
          where: {
            societyId,
            status: 'COMPLETED',
            completedDate: {
              gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            },
          },
        }),
      ]);

      const upcomingJobs = await prisma.serviceJob.findMany({
        where: {
          societyId,
          status: { in: ['PENDING', 'IN_PROGRESS'] },
          scheduledDate: { gte: new Date() },
        },
        include: { asset: { select: { name: true, type: true } } },
        orderBy: { scheduledDate: 'asc' },
        take: 5,
      });

      return res.json({
        totalAssets,
        activeAssets,
        overdueJobs,
        pendingJobs,
        completedThisMonth,
        upcomingJobs,
      });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch dashboard' });
    }
  },
);

// ── LIST ASSETS ─────────────────────────────────────────
router.get(
  '/',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [
    query('type').optional().isIn([...ASSET_TYPES]),
    query('blockId').optional().isUUID(),
    query('active').optional().isIn(['true', 'false']),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const where: any = { societyId: req.user!.societyId! };
      if (req.query.type) where.type = req.query.type;
      if (req.query.blockId) where.blockId = req.query.blockId;
      if (req.query.active !== undefined) where.isActive = req.query.active === 'true';

      const assets = await prisma.asset.findMany({
        where,
        include: {
          block: { select: { name: true } },
          _count: { select: { serviceJobs: true, serviceHistory: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.json(assets.map(parseImages));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch assets' });
    }
  },
);

// ── GET SINGLE ASSET ────────────────────────────────────
router.get(
  '/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const asset = await prisma.asset.findUnique({
        where: { id: req.params.id },
        include: {
          block: { select: { name: true } },
          serviceJobs: {
            orderBy: { scheduledDate: 'desc' },
            take: 10,
            include: { assignedUser: { select: { name: true } } },
          },
          serviceHistory: { orderBy: { serviceDate: 'desc' }, take: 10 },
        },
      });

      if (!asset) return res.status(404).json({ error: 'Asset not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && asset.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Parse images on nested records too
      asset.serviceJobs = asset.serviceJobs.map(parseImages);
      asset.serviceHistory = asset.serviceHistory.map(parseImages);
      return res.json(parseImages(asset));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch asset' });
    }
  },
);

// ── CREATE ASSET ────────────────────────────────────────
router.post(
  '/',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  upload.array('images', 3),
  [
    body('name').trim().notEmpty(),
    body('type').isIn([...ASSET_TYPES]),
    body('location').optional({ values: 'falsy' }).trim(),
    body('blockId').optional({ values: 'falsy' }).isUUID(),
    body('description').optional({ values: 'falsy' }).trim(),
    body('installationDate').optional({ values: 'falsy' }).isISO8601(),
    body('vendor').optional({ values: 'falsy' }).trim(),
    body('serviceContact').optional({ values: 'falsy' }).trim(),
    body('periodicServiceRequired').optional({ values: 'falsy' }).isIn(['true', 'false']),
    body('serviceFrequency').optional({ values: 'falsy' }).isIn([...SERVICE_FREQUENCIES]),
    body('serviceIntervalDays').optional({ values: 'falsy' }).isInt({ min: 1 }),
    body('lastServiceDate').optional({ values: 'falsy' }).isISO8601(),
    body('nextServiceDate').optional({ values: 'falsy' }).isISO8601(),
    body('serviceVendor').optional({ values: 'falsy' }).trim(),
    body('serviceCost').optional({ values: 'falsy' }).isFloat({ min: 0 }),
    body('serviceNotes').optional({ values: 'falsy' }).trim(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const files = (req.files as Express.Multer.File[]) || [];
      for (const f of files) {
        if (f.size > MAX_IMAGE_SIZE) {
          return res.status(400).json({ error: `Each image must be under 2 MB. "${f.originalname}" is too large.` });
        }
      }
      const imageList = files.map((f) => getFileUrl(f));

      const periodicServiceRequired = req.body.periodicServiceRequired === 'true';

      const asset = await prisma.asset.create({
        data: {
          societyId: req.user!.societyId!,
          name: req.body.name,
          type: req.body.type,
          location: req.body.location || null,
          blockId: req.body.blockId || null,
          description: req.body.description || null,
          installationDate: req.body.installationDate ? new Date(req.body.installationDate) : null,
          vendor: req.body.vendor || null,
          serviceContact: req.body.serviceContact || null,
          periodicServiceRequired,
          serviceFrequency: periodicServiceRequired ? req.body.serviceFrequency || null : null,
          serviceIntervalDays: periodicServiceRequired && req.body.serviceIntervalDays ? parseInt(req.body.serviceIntervalDays) : null,
          lastServiceDate: req.body.lastServiceDate ? new Date(req.body.lastServiceDate) : null,
          nextServiceDate: req.body.nextServiceDate ? new Date(req.body.nextServiceDate) : null,
          serviceVendor: req.body.serviceVendor || null,
          serviceCost: req.body.serviceCost ? parseFloat(req.body.serviceCost) : null,
          serviceNotes: req.body.serviceNotes || null,
          images: JSON.stringify(imageList),
        },
        include: { block: { select: { name: true } } },
      });

      return res.status(201).json(parseImages(asset));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create asset' });
    }
  },
);

// ── UPDATE ASSET ────────────────────────────────────────
router.put(
  '/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  upload.array('images', 3),
  [
    param('id').isUUID(),
    body('name').optional().trim().notEmpty(),
    body('type').optional({ values: 'falsy' }).isIn([...ASSET_TYPES]),
    body('location').optional({ values: 'falsy' }).trim(),
    body('blockId').optional({ values: 'falsy' }),
    body('description').optional({ values: 'falsy' }).trim(),
    body('installationDate').optional({ values: 'falsy' }).isISO8601(),
    body('vendor').optional({ values: 'falsy' }).trim(),
    body('serviceContact').optional({ values: 'falsy' }).trim(),
    body('periodicServiceRequired').optional({ values: 'falsy' }).isIn(['true', 'false']),
    body('serviceFrequency').optional({ values: 'falsy' }).isIn([...SERVICE_FREQUENCIES]),
    body('serviceIntervalDays').optional({ values: 'falsy' }).isInt({ min: 1 }),
    body('lastServiceDate').optional({ values: 'falsy' }).isISO8601(),
    body('nextServiceDate').optional({ values: 'falsy' }).isISO8601(),
    body('serviceVendor').optional({ values: 'falsy' }).trim(),
    body('serviceCost').optional({ values: 'falsy' }).isFloat({ min: 0 }),
    body('serviceNotes').optional({ values: 'falsy' }).trim(),
    body('isActive').optional({ values: 'falsy' }).isIn(['true', 'false']),
    body('existingImages').optional({ values: 'falsy' }).isString(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const existing = await prisma.asset.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Asset not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && existing.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const files = (req.files as Express.Multer.File[]) || [];
      for (const f of files) {
        if (f.size > MAX_IMAGE_SIZE) {
          return res.status(400).json({ error: `Each image must be under 2 MB. "${f.originalname}" is too large.` });
        }
      }
      const newImages = files.map((f) => getFileUrl(f));
      let existingImages: string[] = [];
      if (req.body.existingImages) {
        try { existingImages = JSON.parse(req.body.existingImages); } catch { /* ignore */ }
      }
      const allImages = [...existingImages, ...newImages];

      const data: any = {};
      if (req.body.name !== undefined) data.name = req.body.name;
      if (req.body.type !== undefined) data.type = req.body.type;
      if (req.body.location !== undefined) data.location = req.body.location || null;
      if (req.body.blockId !== undefined) data.blockId = req.body.blockId || null;
      if (req.body.description !== undefined) data.description = req.body.description || null;
      if (req.body.installationDate !== undefined) data.installationDate = req.body.installationDate ? new Date(req.body.installationDate) : null;
      if (req.body.vendor !== undefined) data.vendor = req.body.vendor || null;
      if (req.body.serviceContact !== undefined) data.serviceContact = req.body.serviceContact || null;
      if (req.body.isActive !== undefined) data.isActive = req.body.isActive === 'true';

      if (req.body.periodicServiceRequired !== undefined) {
        data.periodicServiceRequired = req.body.periodicServiceRequired === 'true';
      }
      if (req.body.serviceFrequency !== undefined) data.serviceFrequency = req.body.serviceFrequency || null;
      if (req.body.serviceIntervalDays !== undefined) data.serviceIntervalDays = req.body.serviceIntervalDays ? parseInt(req.body.serviceIntervalDays) : null;
      if (req.body.lastServiceDate !== undefined) data.lastServiceDate = req.body.lastServiceDate ? new Date(req.body.lastServiceDate) : null;
      if (req.body.nextServiceDate !== undefined) data.nextServiceDate = req.body.nextServiceDate ? new Date(req.body.nextServiceDate) : null;
      if (req.body.serviceVendor !== undefined) data.serviceVendor = req.body.serviceVendor || null;
      if (req.body.serviceCost !== undefined) data.serviceCost = req.body.serviceCost ? parseFloat(req.body.serviceCost) : null;
      if (req.body.serviceNotes !== undefined) data.serviceNotes = req.body.serviceNotes || null;

      data.images = JSON.stringify(allImages);

      const asset = await prisma.asset.update({
        where: { id: req.params.id },
        data,
        include: { block: { select: { name: true } } },
      });

      return res.json(parseImages(asset));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update asset' });
    }
  },
);

// ── DELETE ASSET ────────────────────────────────────────
router.delete(
  '/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const existing = await prisma.asset.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Asset not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && existing.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      await prisma.asset.delete({ where: { id: req.params.id } });
      return res.json({ message: 'Asset deleted' });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to delete asset' });
    }
  },
);

// ═══════════════════════════════════════════════════════
//  SERVICE JOBS
// ═══════════════════════════════════════════════════════

// ── LIST JOBS ───────────────────────────────────────────
router.get(
  '/jobs/list',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [
    query('status').optional().isIn([...JOB_STATUSES]),
    query('assetId').optional().isUUID(),
    query('priority').optional().isIn([...JOB_PRIORITIES]),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const where: any = { societyId: req.user!.societyId! };
      if (req.query.status) where.status = req.query.status;
      if (req.query.assetId) where.assetId = req.query.assetId;
      if (req.query.priority) where.priority = req.query.priority;

      const jobs = await prisma.serviceJob.findMany({
        where,
        include: {
          asset: { select: { name: true, type: true, location: true } },
          assignedUser: { select: { name: true } },
        },
        orderBy: { scheduledDate: 'asc' },
      });

      return res.json(jobs.map(parseImages));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch jobs' });
    }
  },
);

// ── CREATE JOB ──────────────────────────────────────────
router.post(
  '/jobs',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  upload.array('images', 3),
  [
    body('assetId').isUUID(),
    body('jobType').optional().trim(),
    body('scheduledDate').isISO8601(),
    body('assignedTo').optional().trim(),
    body('assignedToUserId').optional().isUUID(),
    body('priority').optional().isIn([...JOB_PRIORITIES]),
    body('remarks').optional().trim(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.societyId!;

      // Verify asset belongs to society
      const asset = await prisma.asset.findUnique({ where: { id: req.body.assetId } });
      if (!asset || asset.societyId !== societyId) {
        return res.status(404).json({ error: 'Asset not found' });
      }

      const files = (req.files as Express.Multer.File[]) || [];
      for (const f of files) {
        if (f.size > MAX_IMAGE_SIZE) {
          return res.status(400).json({ error: `Each image must be under 2 MB. "${f.originalname}" is too large.` });
        }
      }
      const imageList = files.map((f) => getFileUrl(f));

      const job = await prisma.serviceJob.create({
        data: {
          assetId: req.body.assetId,
          societyId,
          jobType: req.body.jobType || 'Periodic Service',
          scheduledDate: new Date(req.body.scheduledDate),
          assignedTo: req.body.assignedTo || null,
          assignedToUserId: req.body.assignedToUserId || null,
          priority: req.body.priority || 'MEDIUM',
          remarks: req.body.remarks || null,
          images: JSON.stringify(imageList),
        },
        include: {
          asset: { select: { name: true, type: true } },
          assignedUser: { select: { name: true } },
        },
      });

      return res.status(201).json(parseImages(job));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create job' });
    }
  },
);

// ── UPDATE JOB STATUS ───────────────────────────────────
router.patch(
  '/jobs/:id/status',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  upload.array('images', 3),
  [
    param('id').isUUID(),
    body('status').isIn([...JOB_STATUSES]),
    body('remarks').optional().trim(),
    body('completedDate').optional().isISO8601(),
    body('scheduledDate').optional().isISO8601(),
    body('invoiceUrl').optional().trim(),
    body('cost').optional().isFloat({ min: 0 }),
    body('vendor').optional().trim(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const existing = await prisma.serviceJob.findUnique({
        where: { id: req.params.id },
        include: { asset: true },
      });
      if (!existing) return res.status(404).json({ error: 'Job not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && existing.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const files = (req.files as Express.Multer.File[]) || [];
      for (const f of files) {
        if (f.size > MAX_IMAGE_SIZE) {
          return res.status(400).json({ error: `Each image must be under 2 MB. "${f.originalname}" is too large.` });
        }
      }
      const newImages = files.map((f) => getFileUrl(f));

      // Merge with existing images
      let currentImages: string[] = [];
      try { currentImages = JSON.parse(existing.images); } catch { /* ignore */ }
      const allImages = [...currentImages, ...newImages];

      const data: any = {
        status: req.body.status,
        images: JSON.stringify(allImages),
      };
      if (req.body.remarks !== undefined) data.remarks = req.body.remarks;
      if (req.body.scheduledDate) data.scheduledDate = new Date(req.body.scheduledDate);
      if (req.body.invoiceUrl !== undefined) data.invoiceUrl = req.body.invoiceUrl || null;

      if (req.body.status === 'COMPLETED') {
        data.completedDate = req.body.completedDate ? new Date(req.body.completedDate) : new Date();

        // Auto-create service history record
        await prisma.serviceHistory.create({
          data: {
            assetId: existing.assetId,
            societyId: existing.societyId,
            serviceDate: data.completedDate,
            vendor: req.body.vendor || existing.assignedTo || null,
            notes: req.body.remarks || existing.remarks || null,
            cost: req.body.cost ? parseFloat(req.body.cost) : null,
            images: JSON.stringify(allImages),
            invoiceUrl: req.body.invoiceUrl || existing.invoiceUrl || null,
            jobId: existing.id,
          },
        });

        // Update asset lastServiceDate and calculate nextServiceDate
        const assetUpdate: any = { lastServiceDate: data.completedDate };
        if (existing.asset.periodicServiceRequired && existing.asset.serviceIntervalDays) {
          const next = new Date(data.completedDate);
          next.setDate(next.getDate() + existing.asset.serviceIntervalDays);
          assetUpdate.nextServiceDate = next;
        }
        await prisma.asset.update({ where: { id: existing.assetId }, data: assetUpdate });
      }

      const job = await prisma.serviceJob.update({
        where: { id: req.params.id },
        data,
        include: {
          asset: { select: { name: true, type: true } },
          assignedUser: { select: { name: true } },
        },
      });

      return res.json(parseImages(job));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update job' });
    }
  },
);

// ── DELETE JOB ──────────────────────────────────────────
router.delete(
  '/jobs/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const existing = await prisma.serviceJob.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Job not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && existing.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      await prisma.serviceJob.delete({ where: { id: req.params.id } });
      return res.json({ message: 'Job deleted' });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to delete job' });
    }
  },
);

// ═══════════════════════════════════════════════════════
//  SERVICE HISTORY
// ═══════════════════════════════════════════════════════

// ── LIST HISTORY (by asset) ─────────────────────────────
router.get(
  '/history/:assetId',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [param('assetId').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const asset = await prisma.asset.findUnique({ where: { id: req.params.assetId } });
      if (!asset) return res.status(404).json({ error: 'Asset not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && asset.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const history = await prisma.serviceHistory.findMany({
        where: { assetId: req.params.assetId },
        include: { job: { select: { jobType: true, status: true } } },
        orderBy: { serviceDate: 'desc' },
      });

      return res.json(history.map(parseImages));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch service history' });
    }
  },
);

// ── ADD MANUAL HISTORY ENTRY ────────────────────────────
router.post(
  '/history',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  upload.array('images', 3),
  [
    body('assetId').isUUID(),
    body('serviceDate').isISO8601(),
    body('vendor').optional().trim(),
    body('notes').optional().trim(),
    body('cost').optional().isFloat({ min: 0 }),
    body('invoiceUrl').optional().trim(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.societyId!;

      const asset = await prisma.asset.findUnique({ where: { id: req.body.assetId } });
      if (!asset || asset.societyId !== societyId) {
        return res.status(404).json({ error: 'Asset not found' });
      }

      const files = (req.files as Express.Multer.File[]) || [];
      for (const f of files) {
        if (f.size > MAX_IMAGE_SIZE) {
          return res.status(400).json({ error: `Each image must be under 2 MB. "${f.originalname}" is too large.` });
        }
      }
      const imageList = files.map((f) => getFileUrl(f));

      const entry = await prisma.serviceHistory.create({
        data: {
          assetId: req.body.assetId,
          societyId,
          serviceDate: new Date(req.body.serviceDate),
          vendor: req.body.vendor || null,
          notes: req.body.notes || null,
          cost: req.body.cost ? parseFloat(req.body.cost) : null,
          images: JSON.stringify(imageList),
          invoiceUrl: req.body.invoiceUrl || null,
        },
      });

      // Update asset's lastServiceDate if this is the most recent service
      const serviceDate = new Date(req.body.serviceDate);
      if (!asset.lastServiceDate || serviceDate > asset.lastServiceDate) {
        const assetUpdate: any = { lastServiceDate: serviceDate };
        if (asset.periodicServiceRequired && asset.serviceIntervalDays) {
          const next = new Date(serviceDate);
          next.setDate(next.getDate() + asset.serviceIntervalDays);
          assetUpdate.nextServiceDate = next;
        }
        await prisma.asset.update({ where: { id: asset.id }, data: assetUpdate });
      }

      return res.status(201).json(parseImages(entry));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to add service history' });
    }
  },
);

// ── SERVICE DUE REMINDER (called by scheduler) ─────────
export async function sendServiceDueReminders() {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

    // Find assets with nextServiceDate in the next 24h that haven't had a reminder recently
    const dueAssets = await prisma.asset.findMany({
      where: {
        isActive: true,
        periodicServiceRequired: true,
        nextServiceDate: { gte: new Date(), lte: dayAfterTomorrow },
        OR: [
          { lastReminderSentAt: null },
          { lastReminderSentAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        ],
      },
      include: { society: { select: { id: true, name: true } } },
    });

    for (const asset of dueAssets) {
      await sendPushToSocietyRoles(asset.societyId, ['ADMIN', 'SECRETARY'], {
        title: 'Service Due Reminder',
        body: `${asset.name} (${asset.type.replace(/_/g, ' ')}) has a service scheduled for ${asset.nextServiceDate!.toLocaleDateString()}`,
        type: 'asset-service-due',
        entityId: asset.id,
        path: '/assets',
      });

      await prisma.asset.update({
        where: { id: asset.id },
        data: { lastReminderSentAt: new Date() },
      });
    }
  } catch (error) {
    // Silently fail – scheduler will retry
  }
}

export default router;
