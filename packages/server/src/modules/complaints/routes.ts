import { Response, Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest, SOCIETY_MANAGERS, RESIDENT_ROLES } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { upload, getFileUrl } from '../../middleware/upload';
import { notifyComplaintAssignment, notifyComplaintEscalated, notifyComplaintStatusChanged, notifyNewComplaint } from '../notifications/service';

const router = Router();
router.use(authenticate);

const COMPLAINT_CATEGORY_BY_SPECIALIZATION: Record<string, string> = {
  Plumbing: 'Plumbing',
  Plumber: 'Plumbing',
  Electrical: 'Electrical',
  Electrician: 'Electrical',
  Cleaning: 'Cleaning',
  Cleaner: 'Cleaning',
  Lift: 'Lift',
  'Lift Operator': 'Lift',
  Civil: 'Civil',
  Carpenter: 'Civil',
  Security: 'Security',
  Gardening: 'Gardening',
  Gardener: 'Gardening',
  Other: 'Other',
};

const COMPLAINT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REJECTED'] as const;
const COMPLAINT_ACTIONS = ['ASSIGN', 'REASSIGN', 'START_PROGRESS', 'RESOLVE', 'CLOSE', 'REOPEN', 'REJECT'] as const;
const COMPLAINT_ESCALATION_LEVELS = ['MANAGER', 'PRESIDENT'] as const;

type ComplaintStatusValue = (typeof COMPLAINT_STATUSES)[number];
type ComplaintActionValue = (typeof COMPLAINT_ACTIONS)[number];
type ComplaintEscalationLevelValue = (typeof COMPLAINT_ESCALATION_LEVELS)[number];

const COMPLAINT_ASSIGNEE_SELECT = {
  id: true,
  name: true,
  role: true,
  email: true,
  phone: true,
  specialization: true,
} as const;

const COMPLAINT_ASSIGNEE_REVIEW_ROLES = ['JOINT_SECRETARY', 'COMMITTEE_MEMBER'] as const;
const COMPLAINT_MANAGER_ASSIGNABLE_ROLES = ['SERVICE_STAFF', ...COMPLAINT_ASSIGNEE_REVIEW_ROLES, 'ADMIN', 'SECRETARY', 'SUPER_ADMIN'] as const;

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

function parseActivity(activity: any) {
  if (!activity) return activity;
  try {
    activity.metadata = typeof activity.metadata === 'string' ? JSON.parse(activity.metadata) : (activity.metadata || {});
  } catch {
    activity.metadata = {};
  }
  return activity;
}

function parseComplaintRecord(complaint: any) {
  const parsed = parseImages(complaint);
  if (parsed?.activities) {
    parsed.activities = parsed.activities.map(parseActivity);
  }
  return parsed;
}

function stringifyMetadata(metadata?: Record<string, unknown>) {
  return JSON.stringify(metadata || {});
}

async function createComplaintActivity(input: {
  complaintId: string;
  actorId?: string | null;
  actorName: string;
  type: 'CREATED' | 'STATUS_CHANGED' | 'ASSIGNED' | 'COMMENT_ADDED' | 'RESOLUTION_ADDED' | 'ESCALATED' | 'CLOSURE_CONFIRMED';
  message: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.complaintActivity.create({
    data: {
      complaintId: input.complaintId,
      actorId: input.actorId || null,
      actorName: input.actorName,
      type: input.type,
      message: input.message,
      metadata: stringifyMetadata(input.metadata),
    },
  });
}

function isComplaintManager(role?: string) {
  return role === 'SUPER_ADMIN' || SOCIETY_MANAGERS.includes(role as typeof SOCIETY_MANAGERS[number]);
}

function isResidentComplaintRole(role?: string) {
  return RESIDENT_ROLES.includes(role as typeof RESIDENT_ROLES[number]) || role === 'TREASURER';
}

function isComplaintReviewer(role?: string) {
  return role === 'COMMITTEE_MEMBER';
}

function isComplaintReviewerOrStaff(role?: string) {
  return role === 'SERVICE_STAFF' || role === 'COMMITTEE_MEMBER';
}

function getComplaintAssignableRoles(role?: string) {
  if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'SECRETARY' || role === 'JOINT_SECRETARY') {
    return [...COMPLAINT_MANAGER_ASSIGNABLE_ROLES];
  }

  if (role === 'COMMITTEE_MEMBER') {
    return ['SERVICE_STAFF'];
  }

  return [] as string[];
}

function getSpecializationForComplaintCategory(category?: string | null) {
  return getSpecializationsForComplaintCategory(category)[0] || null;
}

function getComplaintCategoryForSpecialization(specialization?: string | null) {
  return COMPLAINT_CATEGORY_BY_SPECIALIZATION[specialization || ''] || '';
}

function getSpecializationsForComplaintCategory(category?: string | null) {
  if (!category) return [] as string[];

  return Object.entries(COMPLAINT_CATEGORY_BY_SPECIALIZATION)
    .filter(([, mappedCategory]) => mappedCategory === category)
    .map(([specialization]) => specialization);
}

async function resolveComplaintActor(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, societyId: true, isActive: true },
  });
}

async function resolveComplaintAssignee(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: COMPLAINT_ASSIGNEE_SELECT,
  });
}

async function resolveComplaintFlatFallback(userId: string, societyId: string) {
  const owner = await prisma.owner.findFirst({
    where: {
      userId,
      isActive: true,
      flat: { block: { societyId } },
    },
    select: {
      flat: {
        include: {
          block: true,
        },
      },
    },
  });

  if (owner?.flat) {
    return owner.flat;
  }

  const tenant = await prisma.tenant.findFirst({
    where: {
      userId,
      isActive: true,
      flat: { block: { societyId } },
    },
    select: {
      flat: {
        include: {
          block: true,
        },
      },
    },
  });

  return tenant?.flat || null;
}

async function enrichComplaintFlatContext(complaint: any) {
  if (!complaint || complaint.flat || !complaint.createdById || !complaint.societyId) {
    return complaint;
  }

  const fallbackFlat = await resolveComplaintFlatFallback(complaint.createdById, complaint.societyId);
  if (!fallbackFlat) {
    return complaint;
  }

  return {
    ...complaint,
    flat: fallbackFlat,
  };
}

async function enrichComplaintFlatContexts(complaints: any[]) {
  return Promise.all(complaints.map(enrichComplaintFlatContext));
}

async function resolveSocietyEscalationTarget(societyId: string, targetLevel: ComplaintEscalationLevelValue, excludeUserIds: string[] = []) {
  if (targetLevel === 'PRESIDENT') {
    const presidentMembership = await prisma.userSocietyMembership.findFirst({
      where: {
        societyId,
        role: 'ADMIN',
        adminAssignmentType: 'PRESIDENT',
        user: { isActive: true, id: { notIn: excludeUserIds } },
      },
      include: { user: { select: { id: true, name: true, role: true, societyId: true, isActive: true } } },
    });

    if (presidentMembership?.user) return presidentMembership.user;

    const fallbackAdmin = await prisma.userSocietyMembership.findFirst({
      where: {
        societyId,
        role: 'ADMIN',
        user: { isActive: true, id: { notIn: excludeUserIds } },
      },
      include: { user: { select: { id: true, name: true, role: true, societyId: true, isActive: true } } },
    });

    return fallbackAdmin?.user || null;
  }

  const memberships = await prisma.userSocietyMembership.findMany({
    where: {
      societyId,
      role: { in: SOCIETY_MANAGERS as any },
      user: { isActive: true, id: { notIn: excludeUserIds } },
      NOT: { adminAssignmentType: 'PRESIDENT' },
    },
    include: { user: { select: { id: true, name: true, role: true, societyId: true, isActive: true } } },
  });

  const priority = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY'];
  const getPriority = (role: string) => {
    const index = priority.indexOf(role);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const sorted = memberships.sort((a, b) => getPriority(a.role) - getPriority(b.role));
  if (sorted[0]?.user) return sorted[0].user;

  return resolveSocietyEscalationTarget(societyId, 'PRESIDENT', excludeUserIds);
}

async function applyComplaintUpdate(params: {
  complaintId: string;
  actorId: string;
  actorName: string;
  existing: any;
  status: ComplaintStatusValue;
  assignedToId?: string;
  resolution?: string;
  actionLabel?: string;
  markClosureConfirmed?: boolean;
}) {
  const { complaintId, actorId, actorName, existing, status, assignedToId, resolution, actionLabel, markClosureConfirmed } = params;
  const data: any = { status };

  if (assignedToId) data.assignedToId = assignedToId;
  if (typeof resolution === 'string') data.resolution = resolution;

  if (status === 'RESOLVED') {
    data.resolvedAt = existing.resolvedAt || new Date();
    data.closureRequestedAt = existing.closureRequestedAt || new Date();
    data.closedAt = null;
    data.residentConfirmedAt = null;
  }

  if (status === 'CLOSED') {
    data.resolvedAt = existing.resolvedAt || new Date();
    data.closureRequestedAt = existing.closureRequestedAt || existing.resolvedAt || new Date();
    data.closedAt = existing.closedAt || new Date();
    if (markClosureConfirmed) {
      data.residentConfirmedAt = existing.residentConfirmedAt || new Date();
    }
  }

  if (status === 'OPEN' || status === 'IN_PROGRESS' || status === 'REJECTED') {
    data.resolvedAt = status === 'REJECTED' ? existing.resolvedAt : null;
    data.closureRequestedAt = null;
    data.residentConfirmedAt = null;
    data.closedAt = null;
  }

  return prisma.$transaction(async (tx) => {
    const updatedComplaint = await tx.complaint.update({
      where: { id: complaintId },
      data,
      include: {
        createdBy: { select: { name: true } },
        assignedTo: { select: COMPLAINT_ASSIGNEE_SELECT },
      },
    });

    if (existing.status !== updatedComplaint.status) {
      await tx.complaintActivity.create({
        data: {
          complaintId: updatedComplaint.id,
          actorId,
          actorName,
          type: 'STATUS_CHANGED',
          message: actionLabel || `Status changed from ${existing.status} to ${updatedComplaint.status}`,
          metadata: stringifyMetadata({ fromStatus: existing.status, toStatus: updatedComplaint.status }),
        },
      });
    }

    if (assignedToId && assignedToId !== existing.assignedToId) {
      await tx.complaintActivity.create({
        data: {
          complaintId: updatedComplaint.id,
          actorId,
          actorName,
          type: 'ASSIGNED',
          message: `Complaint assigned${updatedComplaint.assignedTo?.name ? ` to ${updatedComplaint.assignedTo.name}` : ''}`,
          metadata: stringifyMetadata({
            previousAssigneeId: existing.assignedToId,
            previousAssigneeName: existing.assignedTo?.name || null,
            assignedToId: updatedComplaint.assignedToId,
            assignedToName: updatedComplaint.assignedTo?.name || null,
            assignedToRole: updatedComplaint.assignedTo?.role || null,
            assignedToEmail: updatedComplaint.assignedTo?.email || null,
            assignedToPhone: updatedComplaint.assignedTo?.phone || null,
            assignedToSpecialization: updatedComplaint.assignedTo?.specialization || null,
          }),
        },
      });
    }

    if (typeof resolution === 'string' && resolution !== existing.resolution) {
      await tx.complaintActivity.create({
        data: {
          complaintId: updatedComplaint.id,
          actorId,
          actorName,
          type: 'RESOLUTION_ADDED',
          message: 'Resolution updated',
          metadata: stringifyMetadata({ resolution }),
        },
      });
    }

    if (markClosureConfirmed) {
      await tx.complaintActivity.create({
        data: {
          complaintId: updatedComplaint.id,
          actorId,
          actorName,
          type: 'CLOSURE_CONFIRMED',
          message: 'Resident confirmed closure',
          metadata: stringifyMetadata({ closedAt: updatedComplaint.closedAt, residentConfirmedAt: updatedComplaint.residentConfirmedAt }),
        },
      });
    }

    return updatedComplaint;
  });
}

async function updateComplaintResolution(params: {
  complaintId: string;
  actorId: string;
  actorName: string;
  existing: any;
  resolution: string;
}) {
  const { complaintId, actorId, actorName, existing, resolution } = params;

  return prisma.$transaction(async (tx) => {
    const updatedComplaint = await tx.complaint.update({
      where: { id: complaintId },
      data: { resolution },
      include: {
        createdBy: { select: { name: true } },
        assignedTo: { select: COMPLAINT_ASSIGNEE_SELECT },
      },
    });

    if (resolution !== existing.resolution) {
      await tx.complaintActivity.create({
        data: {
          complaintId: updatedComplaint.id,
          actorId,
          actorName,
          type: 'RESOLUTION_ADDED',
          message: 'Resolution updated',
          metadata: stringifyMetadata({ resolution }),
        },
      });
    }

    return updatedComplaint;
  });
}

function normalizeComplaintAction(action: ComplaintActionValue, existing: any): { status: ComplaintStatusValue; actionLabel: string } {
  switch (action) {
    case 'ASSIGN':
      return { status: existing.status, actionLabel: 'Complaint assigned' };
    case 'REASSIGN':
      return { status: existing.status, actionLabel: 'Complaint reassigned' };
    case 'START_PROGRESS':
      return { status: 'IN_PROGRESS', actionLabel: 'Work started on complaint' };
    case 'RESOLVE':
      return { status: 'RESOLVED', actionLabel: 'Complaint marked as resolved' };
    case 'CLOSE':
      return { status: 'CLOSED', actionLabel: 'Complaint closed' };
    case 'REOPEN':
      return { status: 'OPEN', actionLabel: 'Complaint reopened' };
    case 'REJECT':
      return { status: 'REJECTED', actionLabel: 'Complaint rejected' };
  }
}

// ── GET ALL COMPLAINTS ──────────────────────────────────
router.get(
  '/',
  [
    query('status').optional().isIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REJECTED']),
    query('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
    query('category').optional().isString(),
    query('ownerView').optional().isBoolean(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const where: any = {};
      let serviceStaffCategory = '';
      const ownerViewRequested = req.query.ownerView === 'true';

      if (req.query.status) where.status = req.query.status;
      if (req.query.priority) where.priority = req.query.priority;
      if (req.query.category) where.category = req.query.category;

      // Restrict to user's society
      if (req.user!.societyId) where.societyId = req.user!.societyId;

      if (ownerViewRequested && ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER'].includes(req.user!.role)) {
        if (!req.user!.societyId) return res.json([]);

        const owner = await prisma.owner.findFirst({
          where: { userId: req.user!.id, flat: { block: { societyId: req.user!.societyId } } },
          select: { id: true },
        });
        if (!owner) return res.json([]);

        where.createdById = req.user!.id;
      } else if (isComplaintReviewer(req.user!.role)) {
        where.OR = [
          { assignedToId: req.user!.id },
          { createdById: req.user!.id },
        ];
      } else if ([...RESIDENT_ROLES, 'TREASURER'].includes(req.user!.role as any)) {
        where.createdById = req.user!.id;
      } else if (req.user!.role === 'SERVICE_STAFF') {
        const serviceStaffUser = await prisma.user.findUnique({
          where: { id: req.user!.id },
          select: { specialization: true },
        });

        if (!req.query.category) {
          serviceStaffCategory = getComplaintCategoryForSpecialization(serviceStaffUser?.specialization || '');
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
          assignedTo: { select: COMPLAINT_ASSIGNEE_SELECT },
          _count: { select: { comments: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.json((await enrichComplaintFlatContexts(complaints)).map(parseComplaintRecord));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch complaints' });
    }
  },
);

// ── GET COMPLAINT ASSIGNEE OPTIONS ────────────────────
router.get('/assignees', async (req: AuthRequest, res: Response) => {
  try {
    const assignableRoles = getComplaintAssignableRoles(req.user!.role);
    const requestedCategory = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const matchingSpecializations = getSpecializationsForComplaintCategory(requestedCategory);

    if (!req.user!.societyId || assignableRoles.length === 0) {
      return res.json([]);
    }

    const assignees = await prisma.user.findMany({
      where: {
        societyId: req.user!.societyId,
        isActive: true,
        id: { not: req.user!.id },
        role: { in: assignableRoles as any },
        ...(requestedCategory
          ? {
              OR: [
                { role: { not: 'SERVICE_STAFF' as any } },
                ...(matchingSpecializations.length > 0 ? [{ role: 'SERVICE_STAFF' as any, specialization: { in: matchingSpecializations } }] : []),
              ],
            }
          : {}),
      },
      select: COMPLAINT_ASSIGNEE_SELECT,
      orderBy: [
        { role: 'asc' },
        { name: 'asc' },
      ],
    });

    return res.json(assignees);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch complaint assignees' });
  }
});

// ── GET SINGLE COMPLAINT ────────────────────────────────
router.get('/:id', [param('id').isUUID()], validate, async (req: AuthRequest, res: Response) => {
  try {
    const complaint = await prisma.complaint.findUnique({
      where: { id: req.params.id },
      include: {
        flat: { include: { block: true } },
        createdBy: { select: { name: true, email: true } },
        assignedTo: { select: COMPLAINT_ASSIGNEE_SELECT },
        comments: { orderBy: { createdAt: 'asc' } },
        activities: { orderBy: { createdAt: 'asc' } },
        escalations: {
          include: {
            escalatedBy: { select: { id: true, name: true } },
            escalatedTo: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });

    // SECURITY: Verify complaint belongs to user's society
    if (req.user!.role !== 'SUPER_ADMIN' && complaint.societyId !== req.user!.societyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (isResidentComplaintRole(req.user!.role) && complaint.createdById !== req.user!.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (isComplaintReviewer(req.user!.role) && complaint.createdById !== req.user!.id && complaint.assignedToId !== req.user!.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (req.user!.role === 'SERVICE_STAFF') {
      const serviceStaffUser = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { specialization: true },
      });
      const allowedCategory = getComplaintCategoryForSpecialization(serviceStaffUser?.specialization || '');
      const canAccessComplaint = complaint.assignedToId === req.user!.id
        || complaint.createdById === req.user!.id
        || (!!allowedCategory && complaint.category === allowedCategory);

      if (!canAccessComplaint) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    return res.json(parseComplaintRecord(await enrichComplaintFlatContext(complaint)));
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

      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { name: true },
      });

      const complaint = await prisma.$transaction(async (tx) => {
        const createdComplaint = await tx.complaint.create({
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
            assignedTo: { select: COMPLAINT_ASSIGNEE_SELECT },
          },
        });

        await tx.complaintActivity.create({
          data: {
            complaintId: createdComplaint.id,
            actorId: req.user!.id,
            actorName: user?.name || 'Unknown User',
            type: 'CREATED',
            message: 'Complaint created',
            metadata: stringifyMetadata({
              status: createdComplaint.status,
              priority: createdComplaint.priority,
              category: createdComplaint.category,
            }),
          },
        });

        return createdComplaint;
      });

      notifyNewComplaint(complaint.id).catch(() => {});

      return res.status(201).json(parseComplaintRecord(await enrichComplaintFlatContext(complaint)));
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
    body('status').isIn(COMPLAINT_STATUSES),
    body('assignedToId').optional().isUUID(),
    body('resolution').optional().isString(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // SECURITY: Verify complaint belongs to admin's society
      const existing = await prisma.complaint.findUnique({
        where: { id: req.params.id },
        include: { assignedTo: { select: COMPLAINT_ASSIGNEE_SELECT } },
      });
      if (!existing) return res.status(404).json({ error: 'Complaint not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && existing.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // SERVICE_STAFF can only update complaints assigned to them
      if (req.user!.role === 'SERVICE_STAFF' && existing.assignedToId !== req.user!.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (req.body.status === 'CLOSED') {
        return res.status(400).json({ error: 'Use resident confirmation to close a resolved complaint' });
      }

      const user = await resolveComplaintActor(req.user!.id);

      const complaint = await applyComplaintUpdate({
        complaintId: req.params.id,
        actorId: req.user!.id,
        actorName: user?.name || 'Unknown User',
        existing,
        status: req.body.status as ComplaintStatusValue,
        assignedToId: req.body.assignedToId,
        resolution: req.body.resolution,
      });

      const actorName = user?.name || 'Unknown User';
      if (req.body.assignedToId && req.body.assignedToId !== existing.assignedToId) {
        notifyComplaintAssignment({
          complaintId: complaint.id,
          actorName,
          action: existing.assignedToId ? 'REASSIGN' : 'ASSIGN',
        }).catch(() => {});
      }

      if (existing.status !== complaint.status) {
        notifyComplaintStatusChanged({
          complaintId: complaint.id,
          actorName,
          fromStatus: existing.status,
          toStatus: complaint.status,
        }).catch(() => {});
      }

      return res.json(parseComplaintRecord(await enrichComplaintFlatContext(complaint)));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update complaint' });
    }
  },
);

// ── UPDATE COMPLAINT CATEGORY ───────────────────────────
router.patch(
  '/:id/category',
  [param('id').isUUID(), body('category').trim().notEmpty()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const existing = await prisma.complaint.findUnique({
        where: { id: req.params.id },
        include: { assignedTo: { select: COMPLAINT_ASSIGNEE_SELECT } },
      });

      if (!existing) return res.status(404).json({ error: 'Complaint not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && existing.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const isManager = isComplaintManager(req.user!.role);
      const isAssignedUser = existing.assignedToId === req.user!.id;

      if (!isManager && !isAssignedUser) {
        return res.status(403).json({ error: 'Only managers or the current assignee can change the complaint category' });
      }

      const complaint = await prisma.complaint.update({
        where: { id: req.params.id },
        data: { category: req.body.category },
        include: {
          flat: { include: { block: true } },
          createdBy: { select: { name: true, email: true } },
          assignedTo: { select: COMPLAINT_ASSIGNEE_SELECT },
          comments: { orderBy: { createdAt: 'asc' } },
          activities: { orderBy: { createdAt: 'asc' } },
          escalations: {
            include: {
              escalatedBy: { select: { id: true, name: true } },
              escalatedTo: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      return res.json(parseComplaintRecord(await enrichComplaintFlatContext(complaint)));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update complaint category' });
    }
  },
);

// ── UPDATE COMPLAINT NOTE / RESOLUTION ─────────────────
router.patch(
  '/:id/resolution',
  [param('id').isUUID(), body('resolution').isString()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const existing = await prisma.complaint.findUnique({
        where: { id: req.params.id },
        include: { assignedTo: { select: COMPLAINT_ASSIGNEE_SELECT } },
      });

      if (!existing) return res.status(404).json({ error: 'Complaint not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && existing.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const isManager = isComplaintManager(req.user!.role);
      const isCreator = existing.createdById === req.user!.id;
      const isAssignedStaff = req.user!.role === 'SERVICE_STAFF' && existing.assignedToId === req.user!.id;
      const isAssignedReviewer = req.user!.role === 'COMMITTEE_MEMBER' && existing.assignedToId === req.user!.id;

      if (!isManager && !isCreator && !isAssignedStaff && !isAssignedReviewer) {
        return res.status(403).json({ error: 'Only the requester, assigned reviewer, assigned staff, or managers can update the case note' });
      }

      const actor = await resolveComplaintActor(req.user!.id);
      const complaint = await updateComplaintResolution({
        complaintId: req.params.id,
        actorId: req.user!.id,
        actorName: actor?.name || 'Unknown User',
        existing,
        resolution: req.body.resolution,
      });

      return res.json(parseComplaintRecord(await enrichComplaintFlatContext(complaint)));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update complaint note' });
    }
  },
);

// ── EXPLICIT COMPLAINT ACTIONS ─────────────────────────
router.post(
  '/:id/actions',
  [
    param('id').isUUID(),
    body('action').isIn(COMPLAINT_ACTIONS),
    body('assignedToId').optional().isUUID(),
    body('resolution').optional().isString(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const existing = await prisma.complaint.findUnique({
        where: { id: req.params.id },
        include: { assignedTo: { select: COMPLAINT_ASSIGNEE_SELECT } },
      });

      if (!existing) return res.status(404).json({ error: 'Complaint not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && existing.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const action = req.body.action as ComplaintActionValue;
      const isManager = isComplaintManager(req.user!.role);
      const isCreator = existing.createdById === req.user!.id;
      const isAssignedStaff = req.user!.role === 'SERVICE_STAFF' && existing.assignedToId === req.user!.id;
      const isAssignedReviewer = req.user!.role === 'COMMITTEE_MEMBER' && existing.assignedToId === req.user!.id;
      const isAssignmentAction = action === 'ASSIGN' || action === 'REASSIGN';

      if (req.user!.role === 'SERVICE_STAFF' && !isAssignedStaff) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (req.user!.role === 'COMMITTEE_MEMBER' && !isAssignedReviewer && !isCreator) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if ((action === 'START_PROGRESS' || action === 'RESOLVE') && !isManager && !isAssignedStaff) {
        return res.status(403).json({ error: 'Only managers or assigned staff can update work progress' });
      }

      if (isAssignmentAction) {
        const assignableRoles = getComplaintAssignableRoles(req.user!.role);
        const canAssignAsReviewer = req.user!.role === 'COMMITTEE_MEMBER' && isAssignedReviewer;

        if (!isManager && !canAssignAsReviewer) {
          return res.status(403).json({ error: 'You do not have permission to assign complaints' });
        }

        if (assignableRoles.length === 0) {
          return res.status(403).json({ error: 'You do not have permission to assign complaints' });
        }
      }

      if ((action === 'CLOSE' || action === 'REJECT') && !isManager) {
        if (!(action === 'CLOSE' && isCreator)) {
          return res.status(403).json({ error: action === 'CLOSE' ? 'Only the requester can confirm closure' : 'Only managers can reject complaints' });
        }
      }

      if (action === 'CLOSE') {
        if (!isCreator) {
          return res.status(403).json({ error: 'Only the requester can confirm closure' });
        }
        if (existing.status !== 'RESOLVED') {
          return res.status(400).json({ error: 'Only resolved complaints can be confirmed and closed' });
        }
      }

      if (action === 'REOPEN' && !isManager && !isCreator && !isAssignedStaff) {
        return res.status(403).json({ error: 'Only the requester, assigned staff, or managers can reopen complaints' });
      }

      if (isAssignmentAction && !req.body.assignedToId) {
        return res.status(400).json({ error: 'assignedToId is required for assignment actions' });
      }

      if (isAssignmentAction && req.body.assignedToId) {
        const assignee = await resolveComplaintAssignee(req.body.assignedToId);
        const allowedAssigneeRoles = new Set(getComplaintAssignableRoles(req.user!.role));

        if (!assignee || assignee.role === undefined || !allowedAssigneeRoles.has(assignee.role)) {
          return res.status(400).json({ error: 'Assigned user is not eligible for this complaint workflow' });
        }

        const activeAssignee = await resolveComplaintActor(req.body.assignedToId);
        if (!activeAssignee || !activeAssignee.isActive || activeAssignee.societyId !== existing.societyId) {
          return res.status(400).json({ error: 'Assigned user must be active and belong to the same society' });
        }
      }

      const actor = await resolveComplaintActor(req.user!.id);
      const normalized = normalizeComplaintAction(action, existing);
      const complaint = await applyComplaintUpdate({
        complaintId: req.params.id,
        actorId: req.user!.id,
        actorName: actor?.name || 'Unknown User',
        existing,
        status: normalized.status,
        assignedToId: req.body.assignedToId,
        resolution: req.body.resolution,
        actionLabel: normalized.actionLabel,
        markClosureConfirmed: action === 'CLOSE',
      });

      const actorName = actor?.name || 'Unknown User';
      if (req.body.assignedToId && req.body.assignedToId !== existing.assignedToId) {
        notifyComplaintAssignment({
          complaintId: complaint.id,
          actorName,
          action: action === 'REASSIGN' ? 'REASSIGN' : 'ASSIGN',
        }).catch(() => {});
      }

      if (existing.status !== complaint.status) {
        notifyComplaintStatusChanged({
          complaintId: complaint.id,
          actorName,
          fromStatus: existing.status,
          toStatus: complaint.status,
        }).catch(() => {});
      }

      return res.json(parseComplaintRecord(await enrichComplaintFlatContext(complaint)));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to apply complaint action' });
    }
  },
);

// ── MANUAL ESCALATION ──────────────────────────────────
router.post(
  '/:id/escalate',
  [
    param('id').isUUID(),
    body('reason').trim().notEmpty(),
    body('targetLevel').optional().isIn(COMPLAINT_ESCALATION_LEVELS),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const complaint = await prisma.complaint.findUnique({
        where: { id: req.params.id },
        include: {
          assignedTo: { select: { id: true, name: true } },
          escalations: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });

      if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
      if (req.user!.role !== 'SUPER_ADMIN' && complaint.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const isManager = isComplaintManager(req.user!.role);
      const isAssignedStaff = req.user!.role === 'SERVICE_STAFF' && complaint.assignedToId === req.user!.id;
      const isCreator = complaint.createdById === req.user!.id;

      if (!isManager && !isAssignedStaff && !isCreator) {
        return res.status(403).json({ error: 'Only the requester, assigned staff, or managers can escalate complaints' });
      }

      const actor = await resolveComplaintActor(req.user!.id);
      const requestedLevel = req.body.targetLevel as ComplaintEscalationLevelValue | undefined;
      const derivedLevel: ComplaintEscalationLevelValue = requestedLevel
        || (isManager ? 'PRESIDENT' : 'MANAGER');

      const target = await resolveSocietyEscalationTarget(complaint.societyId, derivedLevel, [req.user!.id, complaint.assignedToId].filter(Boolean) as string[]);
      if (!target) {
        return res.status(400).json({ error: `No eligible ${derivedLevel.toLowerCase()} escalation target found` });
      }

      const updatedComplaint = await prisma.$transaction(async (tx) => {
        const escalation = await tx.complaintEscalation.create({
          data: {
            complaintId: complaint.id,
            escalatedById: req.user!.id,
            escalatedToId: target.id,
            targetLevel: derivedLevel,
            reason: req.body.reason,
          },
        });

        const reassignedComplaint = await tx.complaint.update({
          where: { id: complaint.id },
          data: {
            assignedToId: target.id,
            status: complaint.status === 'OPEN' ? 'IN_PROGRESS' : complaint.status,
          },
          include: {
            createdBy: { select: { name: true } },
            assignedTo: { select: COMPLAINT_ASSIGNEE_SELECT },
          },
        });

        await tx.complaintActivity.create({
          data: {
            complaintId: complaint.id,
            actorId: req.user!.id,
            actorName: actor?.name || 'Unknown User',
            type: 'ESCALATED',
            message: `Complaint escalated to ${target.name}`,
            metadata: stringifyMetadata({
              escalationId: escalation.id,
              targetLevel: derivedLevel,
              reason: req.body.reason,
              previousAssigneeId: complaint.assignedToId,
              previousAssigneeName: complaint.assignedTo?.name || null,
              escalatedToId: target.id,
              escalatedToName: target.name,
              escalatedToRole: target.role,
            }),
          },
        });

        if (complaint.assignedToId !== target.id) {
          await tx.complaintActivity.create({
            data: {
              complaintId: complaint.id,
              actorId: req.user!.id,
              actorName: actor?.name || 'Unknown User',
              type: 'ASSIGNED',
              message: `Complaint assigned to ${target.name}`,
              metadata: stringifyMetadata({
                previousAssigneeId: complaint.assignedToId,
                previousAssigneeName: complaint.assignedTo?.name || null,
                assignedToId: target.id,
                assignedToName: target.name,
              }),
            },
          });
        }

        if (complaint.status === 'OPEN') {
          await tx.complaintActivity.create({
            data: {
              complaintId: complaint.id,
              actorId: req.user!.id,
              actorName: actor?.name || 'Unknown User',
              type: 'STATUS_CHANGED',
              message: 'Status changed from OPEN to IN_PROGRESS',
              metadata: stringifyMetadata({ fromStatus: 'OPEN', toStatus: 'IN_PROGRESS' }),
            },
          });
        }

        return reassignedComplaint;
      });

      notifyComplaintEscalated({
        complaintId: updatedComplaint.id,
        actorName: actor?.name || 'Unknown User',
        targetLevel: derivedLevel,
      }).catch(() => {});

      if (complaint.assignedToId !== updatedComplaint.assignedToId) {
        notifyComplaintAssignment({
          complaintId: updatedComplaint.id,
          actorName: actor?.name || 'Unknown User',
          action: 'ESCALATE_ASSIGN',
        }).catch(() => {});
      }

      if (complaint.status !== updatedComplaint.status) {
        notifyComplaintStatusChanged({
          complaintId: updatedComplaint.id,
          actorName: actor?.name || 'Unknown User',
          fromStatus: complaint.status,
          toStatus: updatedComplaint.status,
        }).catch(() => {});
      }

      return res.json(parseComplaintRecord(await enrichComplaintFlatContext(updatedComplaint)));
    } catch (error) {
      return res.status(500).json({ error: 'Failed to escalate complaint' });
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

      const canComment = isComplaintManager(req.user!.role) || RESIDENT_ROLES.includes(req.user!.role as typeof RESIDENT_ROLES[number]);
      if (!canComment) {
        return res.status(403).json({ error: 'Only residents and society admins can participate in the conversation' });
      }

      if (isResidentComplaintRole(req.user!.role) && complaint.createdById !== req.user!.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { name: true },
      });

      const comment = await prisma.$transaction(async (tx) => {
        const createdComment = await tx.complaintComment.create({
          data: {
            complaintId: req.params.id,
            authorName: user!.name,
            content: req.body.content,
          },
        });

        await tx.complaintActivity.create({
          data: {
            complaintId: req.params.id,
            actorId: req.user!.id,
            actorName: user!.name,
            type: 'COMMENT_ADDED',
            message: 'Comment added',
            metadata: stringifyMetadata({ commentId: createdComment.id }),
          },
        });

        return createdComment;
      });

      return res.status(201).json(comment);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to add comment' });
    }
  },
);

export default router;
