import prisma from '../../config/database';
import { getFileUrl } from '../../middleware/upload';
import { sendPushToSocietyRoles } from '../notifications/service';

const MAX_IMAGE_SIZE = 2 * 1024 * 1024;

export function parseImages(record: any) {
  if (!record) return record;
  try {
    record.images = typeof record.images === 'string' ? JSON.parse(record.images) : (record.images || []);
  } catch {
    record.images = [];
  }
  return record;
}

export function validateImageSizes(files: Express.Multer.File[]) {
  const oversized = files.find((file) => file.size > MAX_IMAGE_SIZE);
  return oversized ? `Each image must be under 2 MB. "${oversized.originalname}" is too large.` : null;
}

export function getImageUrls(files: Express.Multer.File[]) {
  return files.map((file) => getFileUrl(file));
}

function parseExistingImages(value: unknown) {
  if (!value) return [] as string[];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export const getAssetDashboard = async (societyId: string) => {
  const [totalAssets, activeAssets, overdueJobs, pendingJobs, completedThisMonth] = await Promise.all([
    prisma.asset.count({ where: { societyId } }),
    prisma.asset.count({ where: { societyId, isActive: true } }),
    prisma.serviceJob.count({ where: { societyId, status: { in: ['PENDING', 'IN_PROGRESS'] }, scheduledDate: { lt: new Date() } } }),
    prisma.serviceJob.count({ where: { societyId, status: 'PENDING' } }),
    prisma.serviceJob.count({
      where: {
        societyId,
        status: 'COMPLETED',
        completedDate: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      },
    }),
  ]);

  const upcomingJobs = await prisma.serviceJob.findMany({
    where: { societyId, status: { in: ['PENDING', 'IN_PROGRESS'] }, scheduledDate: { gte: new Date() } },
    include: { asset: { select: { name: true, type: true } } },
    orderBy: { scheduledDate: 'asc' },
    take: 5,
  });

  return { totalAssets, activeAssets, overdueJobs, pendingJobs, completedThisMonth, upcomingJobs };
};

export const listAssets = async (societyId: string, query: Record<string, any>) => {
  const where: any = { societyId };
  if (query.type) where.type = query.type;
  if (query.blockId) where.blockId = query.blockId;
  if (query.active !== undefined) where.isActive = query.active === 'true';

  const assets = await prisma.asset.findMany({
    where,
    include: { block: { select: { name: true } }, _count: { select: { serviceJobs: true, serviceHistory: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return assets.map(parseImages);
};

export const getAssetById = async (id: string) => {
  const asset: any = await prisma.asset.findUnique({
    where: { id },
    include: {
      block: { select: { name: true } },
      serviceJobs: { orderBy: { scheduledDate: 'desc' }, take: 10, include: { assignedUser: { select: { name: true } } } },
      serviceHistory: { orderBy: { serviceDate: 'desc' }, take: 10 },
    },
  });

  if (!asset) return null;
  asset.serviceJobs = asset.serviceJobs.map(parseImages);
  asset.serviceHistory = asset.serviceHistory.map(parseImages);
  return parseImages(asset);
};

export const createAsset = async (societyId: string, body: Record<string, any>, imageList: string[]) => {
  const periodicServiceRequired = body.periodicServiceRequired === 'true';
  const asset = await prisma.asset.create({
    data: {
      societyId,
      name: body.name,
      type: body.type,
      location: body.location || null,
      blockId: body.blockId || null,
      description: body.description || null,
      installationDate: body.installationDate ? new Date(body.installationDate) : null,
      vendor: body.vendor || null,
      serviceContact: body.serviceContact || null,
      periodicServiceRequired,
      serviceFrequency: periodicServiceRequired ? body.serviceFrequency || null : null,
      serviceIntervalDays: periodicServiceRequired && body.serviceIntervalDays ? parseInt(body.serviceIntervalDays) : null,
      lastServiceDate: body.lastServiceDate ? new Date(body.lastServiceDate) : null,
      nextServiceDate: body.nextServiceDate ? new Date(body.nextServiceDate) : null,
      serviceVendor: body.serviceVendor || null,
      serviceCost: body.serviceCost ? parseFloat(body.serviceCost) : null,
      serviceNotes: body.serviceNotes || null,
      images: JSON.stringify(imageList),
    },
    include: { block: { select: { name: true } } },
  });

  return parseImages(asset);
};

export const findAsset = (id: string) => prisma.asset.findUnique({ where: { id } });

export const updateAsset = async (id: string, body: Record<string, any>, newImages: string[]) => {
  const allImages = [...parseExistingImages(body.existingImages), ...newImages];
  const data: any = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.type !== undefined) data.type = body.type;
  if (body.location !== undefined) data.location = body.location || null;
  if (body.blockId !== undefined) data.blockId = body.blockId || null;
  if (body.description !== undefined) data.description = body.description || null;
  if (body.installationDate !== undefined) data.installationDate = body.installationDate ? new Date(body.installationDate) : null;
  if (body.vendor !== undefined) data.vendor = body.vendor || null;
  if (body.serviceContact !== undefined) data.serviceContact = body.serviceContact || null;
  if (body.isActive !== undefined) data.isActive = body.isActive === 'true';
  if (body.periodicServiceRequired !== undefined) data.periodicServiceRequired = body.periodicServiceRequired === 'true';
  if (body.serviceFrequency !== undefined) data.serviceFrequency = body.serviceFrequency || null;
  if (body.serviceIntervalDays !== undefined) data.serviceIntervalDays = body.serviceIntervalDays ? parseInt(body.serviceIntervalDays) : null;
  if (body.lastServiceDate !== undefined) data.lastServiceDate = body.lastServiceDate ? new Date(body.lastServiceDate) : null;
  if (body.nextServiceDate !== undefined) data.nextServiceDate = body.nextServiceDate ? new Date(body.nextServiceDate) : null;
  if (body.serviceVendor !== undefined) data.serviceVendor = body.serviceVendor || null;
  if (body.serviceCost !== undefined) data.serviceCost = body.serviceCost ? parseFloat(body.serviceCost) : null;
  if (body.serviceNotes !== undefined) data.serviceNotes = body.serviceNotes || null;
  data.images = JSON.stringify(allImages);

  const asset = await prisma.asset.update({ where: { id }, data, include: { block: { select: { name: true } } } });
  return parseImages(asset);
};

export const deleteAsset = (id: string) => prisma.asset.delete({ where: { id } });

export const listJobs = async (societyId: string, query: Record<string, any>) => {
  const where: any = { societyId };
  if (query.status) where.status = query.status;
  if (query.assetId) where.assetId = query.assetId;
  if (query.priority) where.priority = query.priority;
  const jobs = await prisma.serviceJob.findMany({
    where,
    include: { asset: { select: { name: true, type: true, location: true } }, assignedUser: { select: { name: true } } },
    orderBy: { scheduledDate: 'asc' },
  });
  return jobs.map(parseImages);
};

export const createJob = async (societyId: string, body: Record<string, any>, imageList: string[]) => {
  const asset = await prisma.asset.findUnique({ where: { id: body.assetId } });
  if (!asset || asset.societyId !== societyId) return null;
  const job = await prisma.serviceJob.create({
    data: {
      assetId: body.assetId,
      societyId,
      jobType: body.jobType || 'Periodic Service',
      scheduledDate: new Date(body.scheduledDate),
      assignedTo: body.assignedTo || null,
      assignedToUserId: body.assignedToUserId || null,
      priority: body.priority || 'MEDIUM',
      remarks: body.remarks || null,
      images: JSON.stringify(imageList),
    },
    include: { asset: { select: { name: true, type: true } }, assignedUser: { select: { name: true } } },
  });
  return parseImages(job);
};

export const findJobWithAsset = (id: string) => prisma.serviceJob.findUnique({ where: { id }, include: { asset: true } });
export const findJob = (id: string) => prisma.serviceJob.findUnique({ where: { id } });

export const updateJobStatus = async (existing: any, body: Record<string, any>, newImages: string[]) => {
  let currentImages: string[] = [];
  try { currentImages = JSON.parse(existing.images); } catch { /* ignore */ }
  const allImages = [...currentImages, ...newImages];
  const data: any = { status: body.status, images: JSON.stringify(allImages) };
  if (body.remarks !== undefined) data.remarks = body.remarks;
  if (body.scheduledDate) data.scheduledDate = new Date(body.scheduledDate);
  if (body.invoiceUrl !== undefined) data.invoiceUrl = body.invoiceUrl || null;

  if (body.status === 'COMPLETED') {
    data.completedDate = body.completedDate ? new Date(body.completedDate) : new Date();
    await prisma.serviceHistory.create({
      data: {
        assetId: existing.assetId,
        societyId: existing.societyId,
        serviceDate: data.completedDate,
        vendor: body.vendor || existing.assignedTo || null,
        notes: body.remarks || existing.remarks || null,
        cost: body.cost ? parseFloat(body.cost) : null,
        images: JSON.stringify(allImages),
        invoiceUrl: body.invoiceUrl || existing.invoiceUrl || null,
        jobId: existing.id,
      },
    });
    const assetUpdate: any = { lastServiceDate: data.completedDate };
    if (existing.asset.periodicServiceRequired && existing.asset.serviceIntervalDays) {
      const next = new Date(data.completedDate);
      next.setDate(next.getDate() + existing.asset.serviceIntervalDays);
      assetUpdate.nextServiceDate = next;
    }
    await prisma.asset.update({ where: { id: existing.assetId }, data: assetUpdate });
  }

  const job = await prisma.serviceJob.update({
    where: { id: existing.id },
    data,
    include: { asset: { select: { name: true, type: true } }, assignedUser: { select: { name: true } } },
  });
  return parseImages(job);
};

export const deleteJob = (id: string) => prisma.serviceJob.delete({ where: { id } });

export const listHistory = async (assetId: string) => {
  const history = await prisma.serviceHistory.findMany({
    where: { assetId },
    include: { job: { select: { jobType: true, status: true } } },
    orderBy: { serviceDate: 'desc' },
  });
  return history.map(parseImages);
};

export const addHistory = async (societyId: string, body: Record<string, any>, imageList: string[]) => {
  const asset = await prisma.asset.findUnique({ where: { id: body.assetId } });
  if (!asset || asset.societyId !== societyId) return null;
  const entry = await prisma.serviceHistory.create({
    data: {
      assetId: body.assetId,
      societyId,
      serviceDate: new Date(body.serviceDate),
      vendor: body.vendor || null,
      notes: body.notes || null,
      cost: body.cost ? parseFloat(body.cost) : null,
      images: JSON.stringify(imageList),
      invoiceUrl: body.invoiceUrl || null,
    },
  });

  const serviceDate = new Date(body.serviceDate);
  if (!asset.lastServiceDate || serviceDate > asset.lastServiceDate) {
    const assetUpdate: any = { lastServiceDate: serviceDate };
    if (asset.periodicServiceRequired && asset.serviceIntervalDays) {
      const next = new Date(serviceDate);
      next.setDate(next.getDate() + asset.serviceIntervalDays);
      assetUpdate.nextServiceDate = next;
    }
    await prisma.asset.update({ where: { id: asset.id }, data: assetUpdate });
  }

  return parseImages(entry);
};

export async function sendServiceDueReminders() {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

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

      await prisma.asset.update({ where: { id: asset.id }, data: { lastReminderSentAt: new Date() } });
    }
  } catch (error) {
    // Scheduler retries on the next interval.
  }
}