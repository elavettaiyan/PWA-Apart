import { Router, Response } from 'express';
import { body, param, query } from 'express-validator';
import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { sendCampaignEmails } from '../../config/email';
import { authenticate, authorize, AuthRequest, invalidateAuthCache } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { computeTrialStatus } from '../premium/routes';
import { config } from '../../config';

const router = Router();

router.use(authenticate);
router.use(authorize('SUPER_ADMIN'));

type CampaignTargetMode = 'all' | 'specific';

function getServerPublicBaseUrl() {
  const clientUrl = config.clientUrl.replace(/\/$/, '');
  if (clientUrl.includes('localhost:5173')) {
    return 'http://localhost:4000';
  }

  return clientUrl;
}

// ── HELPERS ────────────────────────────────────────────────────

async function logCrmAction(
  performedById: string,
  societyId: string,
  action: string,
  description?: string,
  metadata?: Record<string, unknown>,
) {
  await prisma.crmActionLog.create({
    data: {
      societyId,
      performedById,
      action,
      description: description ?? null,
      metadata: metadata ? (metadata as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  });
}

const SOCIETY_CRM_SELECT = {
  id: true,
  name: true,
  communityType: true,
  city: true,
  state: true,
  pincode: true,
  address: true,
  registrationNo: true,
  isActive: true,
  isPremium: true,
  hadPremiumSubscription: true,
  premiumOverrideUntil: true,
  trialStartedAt: true,
  trialEndsAt: true,
  crmNotes: true,
  crmTags: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      users: true,
      blocks: true,
      complaints: true,
      expenses: true,
    },
  },
} as const;

// ── GET /admin/crm/societies ────────────────────────────────────
// Enhanced list for CRM table with admin contact and subscription status.
router.get(
  '/societies',
  [
    query('search').optional().trim(),
    query('status').optional().isIn(['active', 'inactive']),
    query('premium').optional().isIn(['true', 'false', 'trial', 'override']),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;
      const premiumFilter = typeof req.query.premium === 'string' ? req.query.premium : undefined;

      const now = new Date();
      const whereClause: Record<string, unknown> = {};

      if (search) {
        whereClause.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { city: { contains: search, mode: 'insensitive' } },
          { state: { contains: search, mode: 'insensitive' } },
        ];
      }

      if (statusFilter === 'active') whereClause.isActive = true;
      if (statusFilter === 'inactive') whereClause.isActive = false;

      if (premiumFilter === 'true') whereClause.isPremium = true;
      if (premiumFilter === 'false') {
        whereClause.isPremium = false;
        whereClause.premiumOverrideUntil = { not: { gt: now } };
      }
      if (premiumFilter === 'trial') {
        whereClause.trialStartedAt = { not: null };
        whereClause.trialEndsAt = { gt: now };
        whereClause.isPremium = false;
      }
      if (premiumFilter === 'override') {
        whereClause.premiumOverrideUntil = { gt: now };
      }

      const societies = await prisma.society.findMany({
        where: whereClause,
        select: {
          ...SOCIETY_CRM_SELECT,
          users: {
            where: { role: { in: ['ADMIN', 'SECRETARY'] }, isActive: true },
            select: { id: true, name: true, email: true, phone: true, role: true },
            orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
            take: 1,
          },
          premiumSubscriptions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              status: true,
              lockedFlatCount: true,
              includedFlatCount: true,
              amountPaise: true,
              startDate: true,
              currentPeriodEnd: true,
              nextBillingAt: true,
              cancelledAt: true,
              expiresAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const result = societies.map((s) => {
        const trial = computeTrialStatus(s.trialStartedAt, s.trialEndsAt);
        const isOverrideActive = s.premiumOverrideUntil ? s.premiumOverrideUntil > now : false;
        return {
          ...s,
          primaryContact: s.users[0] ?? null,
          latestSubscription: s.premiumSubscriptions[0] ?? null,
          trial: {
            isOnTrial: trial.isOnTrial,
            isExpired: trial.isExpired,
            daysRemaining: trial.daysRemaining,
          },
          premiumOverrideActive: isOverrideActive,
          users: undefined,
          premiumSubscriptions: undefined,
        };
      });

      return res.json(result);
    } catch (_error) {
      return res.status(500).json({ error: 'Failed to fetch CRM societies' });
    }
  },
);

// ── GET /admin/crm/societies/:id ────────────────────────────────
// Full detail for a single society.
router.get(
  '/societies/:id',
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const [society, flatCount] = await Promise.all([
        prisma.society.findUnique({
          where: { id: req.params.id },
          select: {
            ...SOCIETY_CRM_SELECT,
            users: {
              where: { role: { in: ['ADMIN', 'SECRETARY'] }, isActive: true },
              select: { id: true, name: true, email: true, phone: true, role: true, createdAt: true },
              orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
            },
            premiumSubscriptions: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                id: true,
                status: true,
                lockedFlatCount: true,
                includedFlatCount: true,
                amountPerFlatPaise: true,
                amountPaise: true,
                startDate: true,
                currentPeriodStart: true,
                currentPeriodEnd: true,
                nextBillingAt: true,
                cancelledAt: true,
                expiresAt: true,
                overdueStartedAt: true,
                notes: true,
                createdAt: true,
                payments: {
                  orderBy: { createdAt: 'desc' },
                  take: 5,
                  select: {
                    id: true,
                    status: true,
                    amountPaise: true,
                    paidAt: true,
                    failureReason: true,
                    razorpayPaymentId: true,
                    createdAt: true,
                  },
                },
              },
            },
          },
        }),
        prisma.flat.count({ where: { block: { societyId: req.params.id } } }),
      ]);

      if (!society) return res.status(404).json({ error: 'Society not found' });

      const now = new Date();
      const trial = computeTrialStatus(society.trialStartedAt, society.trialEndsAt);
      const isOverrideActive = society.premiumOverrideUntil ? society.premiumOverrideUntil > now : false;

      return res.json({
        ...society,
        flatCount,
        adminContacts: society.users,
        latestSubscription: society.premiumSubscriptions[0] ?? null,
        trial,
        premiumOverrideActive: isOverrideActive,
        users: undefined,
        premiumSubscriptions: undefined,
      });
    } catch (_error) {
      return res.status(500).json({ error: 'Failed to fetch society detail' });
    }
  },
);

// ── PATCH /admin/crm/societies/:id/status ──────────────────────
// Activate or deactivate a society.
router.patch(
  '/societies/:id/status',
  [param('id').isUUID(), body('isActive').isBoolean()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const society = await prisma.society.findUnique({
        where: { id: req.params.id },
        select: { id: true, name: true, isActive: true },
      });
      if (!society) return res.status(404).json({ error: 'Society not found' });

      const newStatus: boolean = req.body.isActive;
      if (society.isActive === newStatus) {
        return res.status(400).json({ error: `Society is already ${newStatus ? 'active' : 'inactive'}` });
      }

      await prisma.society.update({
        where: { id: society.id },
        data: { isActive: newStatus },
      });

      await logCrmAction(
        req.user!.id,
        society.id,
        newStatus ? 'ACTIVATE_SOCIETY' : 'DEACTIVATE_SOCIETY',
        `Society ${newStatus ? 'activated' : 'deactivated'}: ${society.name}`,
        { before: { isActive: society.isActive }, after: { isActive: newStatus } },
      );

      return res.json({ isActive: newStatus });
    } catch (_error) {
      return res.status(500).json({ error: 'Failed to update society status' });
    }
  },
);

// ── PATCH /admin/crm/societies/:id/trial ───────────────────────
// Extend or set trial expiry date.
router.patch(
  '/societies/:id/trial',
  [param('id').isUUID(), body('trialEndsAt').isISO8601()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const society = await prisma.society.findUnique({
        where: { id: req.params.id },
        select: { id: true, name: true, trialStartedAt: true, trialEndsAt: true },
      });
      if (!society) return res.status(404).json({ error: 'Society not found' });

      const newTrialEndsAt = new Date(req.body.trialEndsAt);
      if (isNaN(newTrialEndsAt.getTime())) {
        return res.status(400).json({ error: 'Invalid date' });
      }

      await prisma.society.update({
        where: { id: society.id },
        data: {
          trialEndsAt: newTrialEndsAt,
          trialStartedAt: society.trialStartedAt ?? new Date(),
        },
      });

      await logCrmAction(
        req.user!.id,
        society.id,
        'EXTEND_TRIAL',
        `Trial extended to ${newTrialEndsAt.toISOString().slice(0, 10)}`,
        { before: { trialEndsAt: society.trialEndsAt }, after: { trialEndsAt: newTrialEndsAt } },
      );

      return res.json({ trialEndsAt: newTrialEndsAt });
    } catch (_error) {
      return res.status(500).json({ error: 'Failed to update trial period' });
    }
  },
);

// ── PATCH /admin/crm/societies/:id/premium-override ────────────
// Manually grant or remove premium override.
router.patch(
  '/societies/:id/premium-override',
  [param('id').isUUID(), body('premiumOverrideUntil').optional({ nullable: true }).isISO8601()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const society = await prisma.society.findUnique({
        where: { id: req.params.id },
        select: { id: true, name: true, premiumOverrideUntil: true },
      });
      if (!society) return res.status(404).json({ error: 'Society not found' });

      const rawValue = req.body.premiumOverrideUntil;
      const newOverride = rawValue ? new Date(rawValue) : null;
      if (newOverride && isNaN(newOverride.getTime())) {
        return res.status(400).json({ error: 'Invalid date' });
      }

      await prisma.society.update({
        where: { id: society.id },
        data: { premiumOverrideUntil: newOverride },
      });

      await logCrmAction(
        req.user!.id,
        society.id,
        newOverride ? 'PREMIUM_OVERRIDE_SET' : 'PREMIUM_OVERRIDE_REMOVED',
        newOverride
          ? `Premium override granted until ${newOverride.toISOString().slice(0, 10)}`
          : 'Premium override removed',
        { before: { premiumOverrideUntil: society.premiumOverrideUntil }, after: { premiumOverrideUntil: newOverride } },
      );

      return res.json({ premiumOverrideUntil: newOverride });
    } catch (_error) {
      return res.status(500).json({ error: 'Failed to update premium override' });
    }
  },
);

// ── PATCH /admin/crm/societies/:id/crm-meta ────────────────────
// Update internal CRM notes and tags.
router.patch(
  '/societies/:id/crm-meta',
  [
    param('id').isUUID(),
    body('crmNotes').optional({ nullable: true }).isString(),
    body('crmTags').optional().isArray(),
    body('crmTags.*').optional().isString().trim().notEmpty(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const society = await prisma.society.findUnique({
        where: { id: req.params.id },
        select: { id: true, name: true, crmNotes: true, crmTags: true },
      });
      if (!society) return res.status(404).json({ error: 'Society not found' });

      const updateData: { crmNotes?: string | null; crmTags?: string[] } = {};
      if ('crmNotes' in req.body) updateData.crmNotes = req.body.crmNotes ?? null;
      if ('crmTags' in req.body) updateData.crmTags = (req.body.crmTags as string[]).map((t: string) => t.trim()).filter(Boolean);

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      const updated = await prisma.society.update({
        where: { id: society.id },
        data: updateData,
        select: { crmNotes: true, crmTags: true },
      });

      await logCrmAction(
        req.user!.id,
        society.id,
        'UPDATE_CRM_META',
        'CRM notes/tags updated',
        { before: { crmNotes: society.crmNotes, crmTags: society.crmTags }, after: updated },
      );

      return res.json(updated);
    } catch (_error) {
      return res.status(500).json({ error: 'Failed to update CRM meta' });
    }
  },
);

// ── GET /admin/crm/societies/:id/payments ─────────────────────
// Paginated payment history for all premium subscriptions.
router.get(
  '/societies/:id/payments',
  [
    param('id').isUUID(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.params.id;
      const society = await prisma.society.findUnique({
        where: { id: societyId },
        select: { id: true },
      });
      if (!society) return res.status(404).json({ error: 'Society not found' });

      const page = (req.query.page as unknown as number) || 1;
      const limit = (req.query.limit as unknown as number) || 20;
      const skip = (page - 1) * limit;

      const [payments, total] = await Promise.all([
        prisma.premiumSubscriptionPayment.findMany({
          where: { premiumSubscription: { societyId } },
          include: {
            premiumSubscription: {
              select: {
                id: true,
                status: true,
                lockedFlatCount: true,
                amountPaise: true,
                startDate: true,
                currentPeriodStart: true,
                currentPeriodEnd: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.premiumSubscriptionPayment.count({
          where: { premiumSubscription: { societyId } },
        }),
      ]);

      return res.json({
        payments,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (_error) {
      return res.status(500).json({ error: 'Failed to fetch payment history' });
    }
  },
);

// ── GET /admin/crm/societies/:id/audit ─────────────────────────
// Audit log for all super admin actions on this society.
router.get(
  '/societies/:id/audit',
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.params.id;
      const society = await prisma.society.findUnique({
        where: { id: societyId },
        select: { id: true },
      });
      if (!society) return res.status(404).json({ error: 'Society not found' });

      const logs = await prisma.crmActionLog.findMany({
        where: { societyId },
        include: {
          performedBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });

      return res.json(logs);
    } catch (_error) {
      return res.status(500).json({ error: 'Failed to fetch audit log' });
    }
  },
);

// ── GET /admin/crm/societies/:id/users ─────────────────────────
// List all active users belonging to a society.
router.get(
  '/societies/:id/users',
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.params.id;
      const society = await prisma.society.findUnique({ where: { id: societyId }, select: { id: true } });
      if (!society) return res.status(404).json({ error: 'Society not found' });

      const memberships = await prisma.userSocietyMembership.findMany({
        where: { societyId },
        include: {
          user: {
            select: { id: true, name: true, email: true, phone: true, role: true, isActive: true, createdAt: true, lastLogin: true, lastLoginPlatform: true },
          },
        },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      });

      return res.json(
        memberships.map((m) => ({
          ...m.user,
          membershipRole: m.role,
        })),
      );
    } catch (_error) {
      return res.status(500).json({ error: 'Failed to fetch society users' });
    }
  },
);

// ── POST /admin/crm/campaign-mails/send ───────────────────────
// Send a separate HTML email to all active users or a specific email list.
router.post(
  '/campaign-mails/send',
  [
    body('targetMode').isIn(['all', 'specific']),
    body('subject').trim().notEmpty().withMessage('Subject is required'),
    body('html').isString().trim().notEmpty().withMessage('HTML message is required'),
    body('recipientEmails').optional().isArray({ min: 1 }).withMessage('Recipient emails must be a non-empty array'),
    body('recipientEmails.*').optional().isEmail().withMessage('Each recipient email must be valid').normalizeEmail({ gmail_remove_dots: false }),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const targetMode = req.body.targetMode as CampaignTargetMode;
      const subject = String(req.body.subject || '').trim();
      const html = String(req.body.html || '');

      let recipientEmails: string[] = [];
      let intendedRecipientCount = 0;
      let skippedCount = 0;
      let skippedReason: string | null = null;
      let requestedRecipients: string[] | null = null;

      if (targetMode === 'all') {
        const users = await prisma.user.findMany({
          where: {
            isActive: true,
            role: { not: 'SUPER_ADMIN' },
            unsubscribedFromCampaignEmails: false,
          },
          select: { email: true },
        });

        intendedRecipientCount = users.length;
        recipientEmails = users.map((user) => user.email);
      } else {
        const requestedEmails = Array.isArray(req.body.recipientEmails) ? req.body.recipientEmails.map((email: string) => String(email).trim().toLowerCase()) : [];
        requestedRecipients = requestedEmails;
        intendedRecipientCount = requestedEmails.length;
        const unsubscribedUsers = requestedEmails.length > 0
          ? await prisma.user.findMany({
              where: {
                email: { in: requestedEmails },
                unsubscribedFromCampaignEmails: true,
              },
              select: { email: true },
            })
          : [];
        const unsubscribedEmails = new Set(unsubscribedUsers.map((user) => user.email.toLowerCase()));
        recipientEmails = requestedEmails.filter((email: string) => !unsubscribedEmails.has(email));
        skippedCount = requestedEmails.length - recipientEmails.length;
        if (skippedCount > 0) {
          skippedReason = 'unsubscribed';
        }
        if (recipientEmails.length === 0) {
          return res.status(400).json({ error: 'No eligible recipient emails remain after unsubscribe filtering' });
        }
      }

      const result = await sendCampaignEmails({
        recipientEmails,
        subject,
        html,
        unsubscribeBaseUrl: `${getServerPublicBaseUrl()}/api/public/unsubscribe/campaign-email`,
        intendedRecipientCount,
      });

      await prisma.crmCampaignHistory.create({
        data: {
          performedById: req.user!.id,
          targetMode,
          subject,
          html,
          intendedRecipientCount: result.intendedRecipientCount,
          recipientCount: result.recipientCount,
          sentCount: result.sentCount,
          failedCount: result.failedCount,
          skippedCount: targetMode === 'all' ? result.intendedRecipientCount - result.recipientCount : skippedCount,
          skippedReason: targetMode === 'all' && result.intendedRecipientCount > result.recipientCount ? 'unsubscribed' : skippedReason,
          requestedRecipients: requestedRecipients ? JSON.stringify(requestedRecipients) : null,
          failedRecipients: result.failedRecipients.length > 0 ? JSON.stringify(result.failedRecipients) : null,
        },
      });

      return res.json({
        ...result,
        targetMode,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'Failed to send campaign email' });
    }
  },
);

router.get(
  '/campaign-mails/history',
  [query('limit').optional().isInt({ min: 1, max: 100 }).toInt()],
  validate,
  async (_req: AuthRequest, res: Response) => {
    try {
      const limit = (_req.query.limit as number | undefined) || 20;
      const records = await prisma.crmCampaignHistory.findMany({
        include: {
          performedBy: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return res.json(records.map((record) => ({
        ...record,
        requestedRecipients: record.requestedRecipients ? JSON.parse(record.requestedRecipients) : null,
        failedRecipients: record.failedRecipients ? JSON.parse(record.failedRecipients) : [],
      })));
    } catch {
      return res.status(500).json({ error: 'Failed to fetch campaign mail history' });
    }
  },
);

// ── DELETE /admin/crm/users/:userId ────────────────────────────
// Anonymise and deactivate a user (same logic as self-deletion).
// Cannot delete another SUPER_ADMIN.
router.delete(
  '/users/:userId',
  [param('userId').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const targetId = req.params.userId;
      if (targetId === req.user!.id) {
        return res.status(400).json({ error: 'Cannot delete your own account via this endpoint' });
      }

      const target = await prisma.user.findUnique({
        where: { id: targetId },
        include: { societyMemberships: { select: { societyId: true, role: true } } },
      });
      if (!target) return res.status(404).json({ error: 'User not found' });
      if (!target.isActive) return res.status(400).json({ error: 'User is already deleted' });
      if (target.role === 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Cannot delete another SUPER_ADMIN account' });
      }

      const anonymizedEmail = `deleted-${target.id}@deleted.dwellhub.local`;
      const anonymizedPhone = target.phone ? `deleted-${target.id.slice(0, 8)}` : null;

      await prisma.$transaction(async (tx) => {
        await tx.owner.updateMany({ where: { userId: target.id }, data: { userId: null } });
        await tx.tenant.updateMany({ where: { userId: target.id }, data: { userId: null } });
        await tx.userSocietyMembership.deleteMany({ where: { userId: target.id } });
        await tx.pushNotificationDevice.deleteMany({ where: { userId: target.id } });
        await tx.userNotification.deleteMany({ where: { userId: target.id } });

        await tx.user.update({
          where: { id: target.id },
          data: {
            email: anonymizedEmail,
            name: 'Deleted User',
            phone: anonymizedPhone,
            passwordHash: 'DELETED',
            isActive: false,
            mustChangePassword: false,
            skipAccountDeletionVerification: false,
            passwordResetToken: null,
            passwordResetExpiry: null,
            societyId: null,
            activeSocietyId: null,
            specialization: null,
          },
        });
      });

      // Log to CRM audit if we know which society this is for
      if (target.societyMemberships.length > 0) {
        await logCrmAction(
          req.user!.id,
          target.societyMemberships[0].societyId,
          'DELETE_USER',
          `User deleted by SUPER_ADMIN: ${target.email}`,
          { deletedUserId: target.id, role: target.role },
        );
      }

      invalidateAuthCache(target.id);

      return res.json({ success: true });
    } catch (_error) {
      return res.status(500).json({ error: 'Failed to delete user' });
    }
  },
);

// ── GET /admin/crm/export ──────────────────────────────────────
// Server-generated CSV export of all societies.
router.get('/export', async (_req: AuthRequest, res: Response) => {
  try {
    const now = new Date();

    const societies = await prisma.society.findMany({
      select: {
        name: true,
        city: true,
        state: true,
        isActive: true,
        isPremium: true,
        premiumOverrideUntil: true,
        trialStartedAt: true,
        trialEndsAt: true,
        crmTags: true,
        createdAt: true,
        users: {
          where: { role: { in: ['ADMIN', 'SECRETARY'] }, isActive: true },
          select: { name: true, email: true, phone: true, role: true },
          orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
          take: 1,
        },
        premiumSubscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true, currentPeriodEnd: true, expiresAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const headers = [
      'Society Name',
      'City',
      'State',
      'Admin Name',
      'Admin Email',
      'Admin Phone',
      'Status',
      'Premium',
      'Override Until',
      'Trial Ends',
      'Subscription Status',
      'Tags',
      'Registered At',
    ];

    const escape = (v: string | null | undefined) => {
      if (v == null) return '';
      const str = String(v);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = societies.map((s) => {
      const contact = s.users[0];
      const sub = s.premiumSubscriptions[0];
      const overrideActive = s.premiumOverrideUntil && s.premiumOverrideUntil > now;
      const premiumStatus = s.isPremium
        ? 'Premium'
        : overrideActive
          ? 'Override'
          : s.trialEndsAt && s.trialEndsAt > now
            ? 'Trial'
            : 'Free';
      return [
        escape(s.name),
        escape(s.city),
        escape(s.state),
        escape(contact?.name),
        escape(contact?.email),
        escape(contact?.phone),
        s.isActive ? 'Active' : 'Inactive',
        premiumStatus,
        escape(s.premiumOverrideUntil?.toISOString().slice(0, 10)),
        escape(s.trialEndsAt?.toISOString().slice(0, 10)),
        escape(sub?.status),
        escape(s.crmTags.join('; ')),
        escape(s.createdAt.toISOString().slice(0, 10)),
      ].join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="societies-export.csv"');
    return res.send(csv);
  } catch (_error) {
    return res.status(500).json({ error: 'Failed to generate export' });
  }
});

export default router;
