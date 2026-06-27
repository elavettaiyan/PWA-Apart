import { Response, Router } from 'express';
import { authenticate, authorize, AuthRequest, SOCIETY_MANAGERS } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { upload } from '../../middleware/upload';
import { sendCreated, sendOk } from '../../lib/http';
import { canAccessSocietyRecord } from './permissions';
import {
  addHistory,
  createAsset,
  createJob,
  deleteAsset,
  deleteJob,
  findAsset,
  findJob,
  findJobWithAsset,
  getAssetById,
  getAssetDashboard,
  getImageUrls,
  listAssets,
  listHistory,
  listJobs,
  updateAsset,
  updateJobStatus,
  validateImageSizes,
} from './service';
import {
  assetIdValidation,
  createAssetValidation,
  createHistoryValidation,
  createJobValidation,
  historyAssetIdValidation,
  jobIdValidation,
  listAssetsValidation,
  listJobsValidation,
  updateAssetValidation,
  updateJobStatusValidation,
} from './validation';

const router = Router();
router.use(authenticate);

const getUploadedImages = (req: AuthRequest, res: Response) => {
  const files = (req.files as Express.Multer.File[]) || [];
  const sizeError = validateImageSizes(files);
  if (sizeError) {
    res.status(400).json({ error: sizeError });
    return null;
  }
  return getImageUrls(files);
};

// ── DASHBOARD STATS ─────────────────────────────────────
router.get(
  '/dashboard',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  async (req: AuthRequest, res: Response) => {
    try {
      return sendOk(res, await getAssetDashboard(req.user!.societyId!));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch dashboard' });
    }
  },
);

// ── LIST ASSETS ─────────────────────────────────────────
router.get(
  '/',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  listAssetsValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      return sendOk(res, await listAssets(req.user!.societyId!, req.query));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch assets' });
    }
  },
);

// ── GET SINGLE ASSET ────────────────────────────────────
router.get(
  '/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  assetIdValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const asset = await getAssetById(req.params.id);
      if (!asset) return res.status(404).json({ error: 'Asset not found' });
      if (!canAccessSocietyRecord(req.user!, asset)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      return sendOk(res, asset);
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
  createAssetValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const imageList = getUploadedImages(req, res);
      if (!imageList) return;
      return sendCreated(res, await createAsset(req.user!.societyId!, req.body, imageList));
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
  updateAssetValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const existing = await findAsset(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Asset not found' });
      if (!canAccessSocietyRecord(req.user!, existing)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const newImages = getUploadedImages(req, res);
      if (!newImages) return;
      return sendOk(res, await updateAsset(req.params.id, req.body, newImages));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update asset' });
    }
  },
);

// ── DELETE ASSET ────────────────────────────────────────
router.delete(
  '/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  assetIdValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const existing = await findAsset(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Asset not found' });
      if (!canAccessSocietyRecord(req.user!, existing)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      await deleteAsset(req.params.id);
      return sendOk(res, { message: 'Asset deleted' });
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
  listJobsValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      return sendOk(res, await listJobs(req.user!.societyId!, req.query));
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
  createJobValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const imageList = getUploadedImages(req, res);
      if (!imageList) return;
      const job = await createJob(req.user!.societyId!, req.body, imageList);
      if (!job) return res.status(404).json({ error: 'Asset not found' });
      return sendCreated(res, job);
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
  updateJobStatusValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const existing = await findJobWithAsset(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Job not found' });
      if (!canAccessSocietyRecord(req.user!, existing)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const newImages = getUploadedImages(req, res);
      if (!newImages) return;
      return sendOk(res, await updateJobStatus(existing, req.body, newImages));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update job' });
    }
  },
);

// ── DELETE JOB ──────────────────────────────────────────
router.delete(
  '/jobs/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  jobIdValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const existing = await findJob(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Job not found' });
      if (!canAccessSocietyRecord(req.user!, existing)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      await deleteJob(req.params.id);
      return sendOk(res, { message: 'Job deleted' });
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
  historyAssetIdValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const asset = await findAsset(req.params.assetId);
      if (!asset) return res.status(404).json({ error: 'Asset not found' });
      if (!canAccessSocietyRecord(req.user!, asset)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      return sendOk(res, await listHistory(req.params.assetId));
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
  createHistoryValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const imageList = getUploadedImages(req, res);
      if (!imageList) return;
      const entry = await addHistory(req.user!.societyId!, req.body, imageList);
      if (!entry) return res.status(404).json({ error: 'Asset not found' });
      return sendCreated(res, entry);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to add service history' });
    }
  },
);

export { sendServiceDueReminders } from './service';

export default router;
