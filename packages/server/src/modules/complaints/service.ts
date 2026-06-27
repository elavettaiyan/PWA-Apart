import prisma from '../../config/database';
import { AuthRequest, RESIDENT_ROLES, SOCIETY_MANAGERS } from '../../middleware/auth';

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

export const COMPLAINT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REJECTED'] as const;
export const COMPLAINT_ACTIONS = ['ASSIGN', 'REASSIGN', 'START_PROGRESS', 'RESOLVE', 'CLOSE', 'REOPEN', 'REJECT'] as const;
export const COMPLAINT_ESCALATION_LEVELS = ['MANAGER', 'PRESIDENT'] as const;

export type ComplaintStatusValue = (typeof COMPLAINT_STATUSES)[number];
export type ComplaintActionValue = (typeof COMPLAINT_ACTIONS)[number];
export type ComplaintEscalationLevelValue = (typeof COMPLAINT_ESCALATION_LEVELS)[number];

export type ComplaintStatusCountMap = Record<ComplaintStatusValue, number>;

export const COMPLAINT_ASSIGNEE_SELECT = {
  id: true,
  name: true,
  role: true,
  email: true,
  phone: true,
  specialization: true,
} as const;

const COMPLAINT_ASSIGNEE_REVIEW_ROLES = ['JOINT_SECRETARY', 'COMMITTEE_MEMBER'] as const;
const COMPLAINT_MANAGER_ASSIGNABLE_ROLES = ['SERVICE_STAFF', ...COMPLAINT_ASSIGNEE_REVIEW_ROLES, 'ADMIN', 'SECRETARY', 'SUPER_ADMIN'] as const;

export function parseImages(complaint: any) {
  if (!complaint) return complaint;
  try {
    complaint.images = typeof complaint.images === 'string' ? JSON.parse(complaint.images) : (complaint.images || []);
  } catch {
    complaint.images = [];
  }
  return complaint;
}

export function parseActivity(activity: any) {
  if (!activity) return activity;
  try {
    activity.metadata = typeof activity.metadata === 'string' ? JSON.parse(activity.metadata) : (activity.metadata || {});
  } catch {
    activity.metadata = {};
  }
  return activity;
}

export function parseComplaintRecord(complaint: any) {
  const parsed = parseImages(complaint);
  if (parsed?.activities) {
    parsed.activities = parsed.activities.map(parseActivity);
  }
  return parsed;
}

export function stringifyMetadata(metadata?: Record<string, unknown>) {
  return JSON.stringify(metadata || {});
}

export async function createComplaintActivity(input: {
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

export function isComplaintManager(role?: string) {
  return role === 'SUPER_ADMIN' || SOCIETY_MANAGERS.includes(role as typeof SOCIETY_MANAGERS[number]);
}

export function isResidentComplaintRole(role?: string) {
  return RESIDENT_ROLES.includes(role as typeof RESIDENT_ROLES[number]) || role === 'TREASURER';
}

export function isComplaintReviewer(role?: string) {
  return role === 'COMMITTEE_MEMBER';
}

export function isComplaintReviewerOrStaff(role?: string) {
  return role === 'SERVICE_STAFF' || role === 'COMMITTEE_MEMBER';
}

export function getComplaintAssignableRoles(role?: string) {
  if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'SECRETARY' || role === 'JOINT_SECRETARY') {
    return [...COMPLAINT_MANAGER_ASSIGNABLE_ROLES];
  }

  if (role === 'COMMITTEE_MEMBER') {
    return ['SERVICE_STAFF'];
  }

  return [] as string[];
}

export function getSpecializationForComplaintCategory(category?: string | null) {
  return getSpecializationsForComplaintCategory(category)[0] || null;
}

export function getComplaintCategoryForSpecialization(specialization?: string | null) {
  return COMPLAINT_CATEGORY_BY_SPECIALIZATION[specialization || ''] || '';
}

export function getSpecializationsForComplaintCategory(category?: string | null) {
  if (!category) return [] as string[];

  return Object.entries(COMPLAINT_CATEGORY_BY_SPECIALIZATION)
    .filter(([, mappedCategory]) => mappedCategory === category)
    .map(([specialization]) => specialization);
}

export function getComplaintPendingDays(createdAt: Date | string) {
  const createdTime = new Date(createdAt).getTime();
  return Math.max(0, Math.floor((Date.now() - createdTime) / (24 * 60 * 60 * 1000)));
}

export async function buildComplaintWhere(req: AuthRequest, filters?: {
  status?: string;
  priority?: string;
  category?: string;
  ownerViewRequested?: boolean;
  minPendingDays?: number;
}) {
  const where: any = {};
  let serviceStaffCategory = '';

  if (filters?.status) where.status = filters.status;
  if (filters?.priority) where.priority = filters.priority;
  if (filters?.category) where.category = filters.category;

  if (typeof filters?.minPendingDays === 'number' && Number.isFinite(filters.minPendingDays) && filters.minPendingDays > 0) {
    const pendingSince = new Date();
    pendingSince.setDate(pendingSince.getDate() - filters.minPendingDays);
    where.createdAt = { lte: pendingSince };
    where.status = where.status || { in: ['OPEN', 'IN_PROGRESS'] };
  }

  if (req.user!.societyId) where.societyId = req.user!.societyId;

  if (filters?.ownerViewRequested && ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER'].includes(req.user!.role)) {
    if (!req.user!.societyId) {
      return { where: { id: { in: [] } }, serviceStaffCategory };
    }

    const owner = await prisma.owner.findFirst({
      where: { userId: req.user!.id, flat: { block: { societyId: req.user!.societyId } } },
      select: { id: true },
    });

    if (!owner) {
      return { where: { id: { in: [] } }, serviceStaffCategory };
    }

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

    if (!filters?.category) {
      serviceStaffCategory = getComplaintCategoryForSpecialization(serviceStaffUser?.specialization || '');
    }

    where.OR = [
      { assignedToId: req.user!.id },
      { createdById: req.user!.id },
      ...(serviceStaffCategory ? [{ category: serviceStaffCategory }] : []),
    ];
  }

  return { where, serviceStaffCategory };
}

export async function resolveComplaintActor(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, societyId: true, isActive: true },
  });
}

export async function resolveComplaintAssignee(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: COMPLAINT_ASSIGNEE_SELECT,
  });
}

export async function resolveComplaintFlatFallback(userId: string, societyId: string) {
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

export async function enrichComplaintFlatContext(complaint: any) {
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

export async function enrichComplaintFlatContexts(complaints: any[]) {
  return Promise.all(complaints.map(enrichComplaintFlatContext));
}

export async function resolveSocietyEscalationTarget(societyId: string, targetLevel: ComplaintEscalationLevelValue, excludeUserIds: string[] = []) {
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

export async function applyComplaintUpdate(params: {
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

export async function updateComplaintResolution(params: {
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

export function normalizeComplaintAction(action: ComplaintActionValue, existing: any): { status: ComplaintStatusValue; actionLabel: string } {
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