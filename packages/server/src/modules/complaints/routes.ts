import { Response, Router } from 'express';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest, SOCIETY_MANAGERS, RESIDENT_ROLES } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { upload, getFileUrl } from '../../middleware/upload';
import { notifyComplaintAssignment, notifyComplaintEscalated, notifyComplaintStatusChanged, notifyNewComplaint } from '../notifications/service';
import {
  applyComplaintUpdate,
  buildComplaintWhere,
  COMPLAINT_ASSIGNEE_SELECT,
  ComplaintActionValue,
  ComplaintEscalationLevelValue,
  ComplaintStatusCountMap,
  ComplaintStatusValue,
  enrichComplaintFlatContext,
  enrichComplaintFlatContexts,
  getComplaintAssignableRoles,
  getComplaintCategoryForSpecialization,
  getComplaintPendingDays,
  getSpecializationsForComplaintCategory,
  isComplaintManager,
  isComplaintReviewer,
  isResidentComplaintRole,
  normalizeComplaintAction,
  parseComplaintRecord,
  resolveComplaintActor,
  resolveComplaintAssignee,
  resolveSocietyEscalationTarget,
  stringifyMetadata,
  updateComplaintResolution,
} from './service';
import {
  addComplaintCommentValidation,
  complaintActionValidation,
  complaintIdValidation,
  createComplaintValidation,
  escalateComplaintValidation,
  listComplaintsValidation,
  updateComplaintCategoryValidation,
  updateComplaintResolutionValidation,
  updateComplaintStatusValidation,
} from './validation';

const router = Router();
router.use(authenticate);

// ── GET ALL COMPLAINTS ──────────────────────────────────
router.get(
  '/',
  listComplaintsValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const ownerViewRequested = req.query.ownerView === 'true';
      const minPendingDays = typeof req.query.minPendingDays === 'string'
        ? Number.parseInt(req.query.minPendingDays, 10)
        : undefined;
      const { where } = await buildComplaintWhere(req, {
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        priority: typeof req.query.priority === 'string' ? req.query.priority : undefined,
        category: typeof req.query.category === 'string' ? req.query.category : undefined,
        ownerViewRequested,
        minPendingDays,
      });

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

router.get(
  '/dashboard',
  authorize('SUPER_ADMIN', 'ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'COMMITTEE_MEMBER'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { where } = await buildComplaintWhere(req);
      const longPendingDays = 7;
      const longPendingDate = new Date();
      longPendingDate.setDate(longPendingDate.getDate() - longPendingDays);

      const longPendingWhere = {
        ...where,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        createdAt: { lte: longPendingDate },
      };

      const [statusGroups, categoryGroups, longPendingCount, longPendingComplaints] = await Promise.all([
        prisma.complaint.groupBy({
          by: ['status'],
          where,
          _count: { _all: true },
        }),
        prisma.complaint.groupBy({
          by: ['category', 'status'],
          where,
          _count: { _all: true },
        }),
        prisma.complaint.count({
          where: longPendingWhere,
        }),
        prisma.complaint.findMany({
          where: longPendingWhere,
          include: {
            flat: { select: { flatNumber: true, block: { select: { name: true } } } },
            createdBy: { select: { name: true } },
            assignedTo: { select: COMPLAINT_ASSIGNEE_SELECT },
            _count: { select: { comments: true } },
          },
          orderBy: [
            { createdAt: 'asc' },
            { priority: 'desc' },
          ],
          take: 10,
        }),
      ]);

      const statusBreakdown: ComplaintStatusCountMap = {
        OPEN: 0,
        IN_PROGRESS: 0,
        RESOLVED: 0,
        CLOSED: 0,
        REJECTED: 0,
      };

      for (const group of statusGroups) {
        statusBreakdown[group.status as ComplaintStatusValue] = group._count._all;
      }

      const categoryMap = new Map<string, {
        category: string;
        totalCount: number;
        openCount: number;
        inProgressCount: number;
        resolvedCount: number;
        closedCount: number;
        rejectedCount: number;
      }>();

      for (const group of categoryGroups) {
        const existing = categoryMap.get(group.category) || {
          category: group.category,
          totalCount: 0,
          openCount: 0,
          inProgressCount: 0,
          resolvedCount: 0,
          closedCount: 0,
          rejectedCount: 0,
        };

        existing.totalCount += group._count._all;

        if (group.status === 'OPEN') existing.openCount += group._count._all;
        if (group.status === 'IN_PROGRESS') existing.inProgressCount += group._count._all;
        if (group.status === 'RESOLVED') existing.resolvedCount += group._count._all;
        if (group.status === 'CLOSED') existing.closedCount += group._count._all;
        if (group.status === 'REJECTED') existing.rejectedCount += group._count._all;

        categoryMap.set(group.category, existing);
      }

      const categoryBreakdown = Array.from(categoryMap.values())
        .sort((left, right) => {
          const leftActive = left.openCount + left.inProgressCount;
          const rightActive = right.openCount + right.inProgressCount;
          if (rightActive !== leftActive) return rightActive - leftActive;
          return right.totalCount - left.totalCount;
        });

      const longPendingItems = (await enrichComplaintFlatContexts(longPendingComplaints))
        .map(parseComplaintRecord)
        .map((complaint: any) => ({
          ...complaint,
          pendingDays: getComplaintPendingDays(complaint.createdAt),
        }));

      return res.json({
        openCount: statusBreakdown.OPEN,
        inProgressCount: statusBreakdown.IN_PROGRESS,
        totalActiveCount: statusBreakdown.OPEN + statusBreakdown.IN_PROGRESS,
        longPendingDays,
        longPendingCount,
        statusBreakdown,
        categoryBreakdown,
        longPendingComplaints: longPendingItems,
      });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch complaint dashboard' });
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
router.get('/:id', complaintIdValidation, validate, async (req: AuthRequest, res: Response) => {
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
  createComplaintValidation,
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
  updateComplaintStatusValidation,
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
  updateComplaintCategoryValidation,
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
  updateComplaintResolutionValidation,
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
  complaintActionValidation,
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
  escalateComplaintValidation,
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
  addComplaintCommentValidation,
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
