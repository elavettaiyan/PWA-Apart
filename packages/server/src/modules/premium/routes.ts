import crypto from 'crypto';
import { Response, Router } from 'express';
import { body } from 'express-validator';
import { PaymentStatus, PremiumSubscriptionStatus } from '@prisma/client';
import { config } from '../../config';
import prisma, { dbReady } from '../../config/database';
import logger from '../../config/logger';
import { authenticate, authorize, AuthRequest, FINANCIAL_ROLES, SOCIETY_MANAGERS } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import {
  buildPremiumLifecycleMessage,
  calculatePremiumLifecycle,
  ensurePremiumLifecycleForSociety,
} from './lifecycle';

const router = Router();

const PRICE_PER_FLAT_PAISE = 2000;
const CURRENCY = 'INR';
const FREE_TIER_FLAT_LIMIT = 5;
const ACTIVE_STATUSES = new Set<PremiumSubscriptionStatus>(['ACTIVE']);
const REUSABLE_PENDING_STATUSES = new Set<PremiumSubscriptionStatus>(['PENDING']);
const SUCCESSFUL_PAYMENT_EVENTS = new Set(['payment.captured']);
const FAILED_PAYMENT_EVENTS = new Set(['payment.failed']);

type RazorpaySubscriptionEntity = {
  id?: string;
  plan_id?: string;
  status?: string;
  quantity?: number;
  remaining_count?: number | string;
  current_start?: number;
  current_end?: number;
  charge_at?: number;
  start_at?: number;
  end_at?: number;
  has_scheduled_changes?: boolean;
  change_scheduled_at?: number;
  notes?: Record<string, string>;
};

type RazorpaySubscriptionUpdateOptions = {
  planId: string;
  quantity: number;
  remainingCount?: number;
  scheduleChangeAt: 'now' | 'cycle_end';
  notes?: Record<string, string>;
};

function requireRazorpayConfig() {
  if (!config.razorpay.keyId || !config.razorpay.keySecret) {
    throw new Error('Razorpay is not configured on the server');
  }
}

function toDate(value?: number | null) {
  return value ? new Date(value * 1000) : null;
}

export function mapProviderStatus(status?: string | null): PremiumSubscriptionStatus {
  switch ((status || '').toLowerCase()) {
    case 'active':
    case 'authenticated':
      return 'ACTIVE';
    case 'pending':
    case 'created':
      return 'PENDING';
    case 'halted':
      return 'HALTED';
    case 'cancelled':
      return 'CANCELLED';
    case 'completed':
      return 'COMPLETED';
    default:
      return 'FAILED';
  }
}

function buildSubscriptionMessage(
  billedFlatCount: number,
  includedFlatCount = billedFlatCount,
  scheduledFlatCount?: number | null,
) {
  if (scheduledFlatCount && scheduledFlatCount > billedFlatCount) {
    return `Your current billing cycle stays at ${billedFlatCount} flats. Flat capacity is unlocked up to ${includedFlatCount} flats now, and the monthly renewal amount will move to ${scheduledFlatCount} flats from the next billing cycle.`;
  }

  if (includedFlatCount > billedFlatCount) {
    return `Your society can manage up to ${includedFlatCount} flats. The current billing cycle is still priced from the previous ${billedFlatCount}-flat snapshot.`;
  }

  return `Your Premium subscription amount is locked at ${billedFlatCount} flats for the current billing cycle.`;
}

export function getMinimumRequiredFlatCount(currentFlatCount: number, includedFlatCount: number, isPremium: boolean) {
  if (!isPremium && currentFlatCount >= FREE_TIER_FLAT_LIMIT) {
    return currentFlatCount + 1;
  }

  if (isPremium) {
    return Math.max(currentFlatCount, includedFlatCount) + 1;
  }

  return Math.max(currentFlatCount, 1);
}

function getScheduledChangeDate(entity?: RazorpaySubscriptionEntity | null) {
  return toDate(entity?.change_scheduled_at ?? entity?.current_end ?? entity?.charge_at);
}

function parseRemainingCount(value?: number | string | null) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function parseFlatCountNote(notes?: Record<string, string> | null) {
  const value = notes?.lockedFlatCount;
  if (!value) {
    return undefined;
  }

  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function isPremiumEntitlementStatus(status: PremiumSubscriptionStatus) {
  return ACTIVE_STATUSES.has(status);
}

export function isReusablePendingSubscriptionStatus(status: PremiumSubscriptionStatus) {
  return REUSABLE_PENDING_STATUSES.has(status);
}

export function classifyPaymentEvent(event?: string): PaymentStatus | null {
  if (event && SUCCESSFUL_PAYMENT_EVENTS.has(event)) {
    return PaymentStatus.SUCCESS;
  }

  if (event && FAILED_PAYMENT_EVENTS.has(event)) {
    return PaymentStatus.FAILED;
  }

  return null;
}

function isSuccessfulPaymentEvent(event?: string) {
  return !!event && SUCCESSFUL_PAYMENT_EVENTS.has(event);
}

function isFailedPaymentEvent(event?: string) {
  return !!event && FAILED_PAYMENT_EVENTS.has(event);
}

async function razorpayRequest<T>(path: string, init?: RequestInit) {
  const credentials = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64');

  const response = await fetch(`${config.razorpay.baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${credentials}`,
      ...(init?.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      data?.error?.description ||
      data?.error?.reason ||
      data?.message ||
      `Razorpay request failed with status ${response.status}`;

    throw new Error(message);
  }

  return data as T;
}

async function getCurrentFlatCount(societyId: string) {
  return prisma.flat.count({ where: { block: { societyId } } });
}

async function createRazorpayPlan(lockedFlatCount: number, amountPaise: number) {
  return razorpayRequest<{ id: string }>('/plans', {
    method: 'POST',
    body: JSON.stringify({
      period: 'monthly',
      interval: 1,
      item: {
        name: `Dwell Hub Premium (${lockedFlatCount} flats)`,
        amount: amountPaise,
        currency: CURRENCY,
        description: `Premium plan locked at ${lockedFlatCount} flats`,
      },
      notes: {
        lockedFlatCount: String(lockedFlatCount),
        amountPaise: String(amountPaise),
        amountPerFlatPaise: String(PRICE_PER_FLAT_PAISE),
      },
    }),
  });
}

async function createRazorpaySubscription(planId: string, societyId: string, lockedFlatCount: number) {
  return razorpayRequest<RazorpaySubscriptionEntity>('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      plan_id: planId,
      total_count: config.razorpay.subscriptionCycles,
      quantity: 1,
      customer_notify: 1,
      notes: {
        societyId,
        lockedFlatCount: String(lockedFlatCount),
      },
    }),
  });
}

async function fetchRazorpaySubscription(subscriptionId: string) {
  return razorpayRequest<RazorpaySubscriptionEntity>(`/subscriptions/${subscriptionId}`, {
    method: 'GET',
  });
}

async function updateRazorpaySubscription(subscriptionId: string, options: RazorpaySubscriptionUpdateOptions) {
  return razorpayRequest<RazorpaySubscriptionEntity>(`/subscriptions/${subscriptionId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      plan_id: options.planId,
      quantity: options.quantity,
      remaining_count: options.remainingCount,
      schedule_change_at: options.scheduleChangeAt,
      customer_notify: 1,
      notes: options.notes,
    }),
  });
}

async function fetchRazorpayPendingSubscriptionUpdate(subscriptionId: string) {
  return razorpayRequest<RazorpaySubscriptionEntity>(`/subscriptions/${subscriptionId}/retrieve_scheduled_changes`, {
    method: 'GET',
  });
}

export function buildSubscriptionUpdate(
  entity: RazorpaySubscriptionEntity,
  existing?: {
    amountPerFlatPaise: number;
    lockedFlatCount: number;
    includedFlatCount: number;
    usesPerFlatQuantity: boolean;
    scheduledFlatCount?: number | null;
    scheduledPlanId?: string | null;
  },
  pendingUpdate?: RazorpaySubscriptionEntity | null,
) {
  const mappedStatus = mapProviderStatus(entity.status);
  const noteFlatCount = parseFlatCountNote(entity.notes);
  const providerQuantity = typeof entity.quantity === 'number' && entity.quantity > 0 ? entity.quantity : null;
  const providerUsesPerFlatQuantity = !!existing && !!providerQuantity && (
    existing.usesPerFlatQuantity || (!!existing.scheduledPlanId && existing.scheduledPlanId === entity.plan_id)
  );
  const lockedFlatCount = existing
    ? providerUsesPerFlatQuantity
      ? providerQuantity || existing.lockedFlatCount
      : noteFlatCount || existing.lockedFlatCount
    : undefined;
  const scheduledFlatCount = entity.has_scheduled_changes
    ? (parseFlatCountNote(pendingUpdate?.notes) ||
      (typeof pendingUpdate?.quantity === 'number' && pendingUpdate.quantity > 1 ? pendingUpdate.quantity : undefined) ||
      existing?.scheduledFlatCount)
    : null;
  const includedFlatCount = existing
    ? entity.has_scheduled_changes
      ? Math.max(existing.includedFlatCount, scheduledFlatCount ?? existing.includedFlatCount)
      : providerUsesPerFlatQuantity
        ? lockedFlatCount || existing.includedFlatCount
        : existing.scheduledPlanId
          ? entity.plan_id === existing.scheduledPlanId
            ? lockedFlatCount || existing.includedFlatCount
            : existing.lockedFlatCount
          : existing.includedFlatCount
    : undefined;

  return {
    status: mappedStatus,
    providerStatus: entity.status || null,
    ...(typeof lockedFlatCount === 'number'
      ? {
          lockedFlatCount,
          includedFlatCount: includedFlatCount || lockedFlatCount,
          amountPaise: lockedFlatCount * existing!.amountPerFlatPaise,
          usesPerFlatQuantity: providerUsesPerFlatQuantity || existing!.usesPerFlatQuantity,
          scheduledFlatCount,
          scheduledAmountPaise: scheduledFlatCount ? scheduledFlatCount * existing!.amountPerFlatPaise : null,
          scheduledChangeAt: entity.has_scheduled_changes ? getScheduledChangeDate(pendingUpdate || entity) : null,
          scheduledPlanId: entity.has_scheduled_changes ? (pendingUpdate?.plan_id || existing!.scheduledPlanId || null) : null,
          notes: buildSubscriptionMessage(
            lockedFlatCount,
            includedFlatCount || lockedFlatCount,
            scheduledFlatCount,
          ),
        }
      : {}),
    startDate: toDate(entity.start_at),
    currentPeriodStart: toDate(entity.current_start),
    currentPeriodEnd: toDate(entity.current_end),
    nextBillingAt: toDate(entity.charge_at),
    expiresAt: toDate(entity.end_at),
    cancelledAt: mappedStatus === 'CANCELLED' ? new Date() : null,
  };
}

async function syncSubscriptionFromProvider(subscriptionId: string) {
  const existing = await prisma.premiumSubscription.findUnique({
    where: { razorpaySubscriptionId: subscriptionId },
  });

  if (!existing) {
    return null;
  }

  const remoteSubscription = await fetchRazorpaySubscription(subscriptionId);
  let pendingUpdate: RazorpaySubscriptionEntity | null = null;

  if (remoteSubscription.has_scheduled_changes) {
    try {
      pendingUpdate = await fetchRazorpayPendingSubscriptionUpdate(subscriptionId);
    } catch (error: any) {
      logger.warn('Failed to fetch scheduled Razorpay subscription update', { error: error.message, subscriptionId });
    }
  }

  const update = buildSubscriptionUpdate(remoteSubscription, existing, pendingUpdate);

  const updated = await prisma.premiumSubscription.update({
    where: { id: existing.id },
    data: update,
  });

  await syncSocietyPremiumFlag(existing.societyId, update.status);

  return {
    existing,
    updated,
    update,
    remoteSubscription,
  };
}

async function syncSocietyPremiumFlag(societyId: string, status: PremiumSubscriptionStatus) {
  await prisma.society.update({
    where: { id: societyId },
    data: {
      isPremium: isPremiumEntitlementStatus(status),
      ...(isPremiumEntitlementStatus(status) ? { hadPremiumSubscription: true } : {}),
    },
  });
}

async function getStatusPayload(societyId: string) {
  const [society, currentFlatCount, activeSubscription, latestSubscription] = await Promise.all([
    prisma.society.findUnique({
      where: { id: societyId },
      select: { id: true, isPremium: true, isActive: true, hadPremiumSubscription: true, name: true },
    }),
    getCurrentFlatCount(societyId),
    prisma.premiumSubscription.findFirst({
      where: { societyId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    }),
    prisma.premiumSubscription.findFirst({
      where: { societyId },
      orderBy: { createdAt: 'desc' },
      include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    }),
  ]);

  const includedFlatCount = activeSubscription?.includedFlatCount || FREE_TIER_FLAT_LIMIT;
  const minimumRequiredFlatCount = getMinimumRequiredFlatCount(currentFlatCount, includedFlatCount, !!activeSubscription);
  const limitReached = !!activeSubscription
    ? currentFlatCount >= includedFlatCount
    : currentFlatCount >= FREE_TIER_FLAT_LIMIT;
  const limitReason = !!activeSubscription
    ? limitReached
      ? 'PREMIUM_CAPACITY'
      : 'NONE'
    : limitReached
      ? 'FREE_TIER'
      : 'NONE';
  const previewLockedFlatCount = activeSubscription?.scheduledFlatCount || activeSubscription?.lockedFlatCount || minimumRequiredFlatCount;
  const previewAmountPaise = previewLockedFlatCount * PRICE_PER_FLAT_PAISE;
  const lifecycle = !activeSubscription && latestSubscription && society?.hadPremiumSubscription
    ? calculatePremiumLifecycle(latestSubscription.overdueStartedAt)
    : calculatePremiumLifecycle(null);
  const lifecycleMessage = buildPremiumLifecycleMessage(lifecycle);

  return {
    isPremium: society?.isPremium ?? false,
    isArchived: !society?.isActive,
    currentFlatCount,
    includedFlatCount,
    scheduledFlatCount: activeSubscription?.scheduledFlatCount ?? null,
    scheduledAmountPaise: activeSubscription?.scheduledAmountPaise ?? null,
    scheduledChangeAt: activeSubscription?.scheduledChangeAt ?? null,
    limit: {
      reached: limitReached,
      reason: limitReason,
      minimumRequiredFlatCount,
      remainingFlatSlots: Math.max(includedFlatCount - currentFlatCount, 0),
    },
    pricing: {
      amountPerFlatPaise: PRICE_PER_FLAT_PAISE,
      amountPerFlat: PRICE_PER_FLAT_PAISE / 100,
      currency: CURRENCY,
    },
    preview: {
      lockedFlatCount: previewLockedFlatCount,
      amountPaise: previewAmountPaise,
      amount: previewAmountPaise / 100,
      currency: CURRENCY,
      message: buildSubscriptionMessage(
        activeSubscription?.lockedFlatCount || previewLockedFlatCount,
        activeSubscription?.includedFlatCount || includedFlatCount,
        activeSubscription?.scheduledFlatCount,
      ),
    },
    overdue: {
      isOverdue: lifecycle.isOverdue,
      stage: lifecycle.stage,
      overdueStartedAt: lifecycle.overdueStartedAt,
      warningEndsAt: lifecycle.warningEndsAt,
      loginBlockedAt: lifecycle.loginBlockedAt,
      archiveAt: lifecycle.archiveAt,
      daysOverdue: lifecycle.daysOverdue,
      adminCanRecover: lifecycle.adminCanRecover,
      message: lifecycleMessage,
    },
    activeSubscription,
    latestSubscription,
  };
}

export async function premiumWebhookHandler(req: AuthRequest, res: Response) {
  await dbReady;

  try {
    if (!config.razorpay.webhookSecret) {
      return res.status(503).json({ error: 'Razorpay webhook secret is not configured' });
    }

    const signature = req.headers['x-razorpay-signature'];
    if (typeof signature !== 'string') {
      return res.status(400).json({ error: 'Missing webhook signature' });
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const expected = crypto.createHmac('sha256', config.razorpay.webhookSecret).update(rawBody).digest('hex');

    if (expected !== signature) {
      logger.warn('Razorpay webhook signature mismatch');
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const event = payload.event as string | undefined;
    const subscriptionEntity = payload?.payload?.subscription?.entity as RazorpaySubscriptionEntity | undefined;
    const paymentEntity = payload?.payload?.payment?.entity as Record<string, any> | undefined;

    if (subscriptionEntity?.id) {
      const existing = await prisma.premiumSubscription.findUnique({
        where: { razorpaySubscriptionId: subscriptionEntity.id },
      });

      if (existing) {
        await syncSubscriptionFromProvider(subscriptionEntity.id);
      }
    }

    if (paymentEntity?.subscription_id) {
      const existing = await prisma.premiumSubscription.findUnique({
        where: { razorpaySubscriptionId: paymentEntity.subscription_id },
      });

      if (existing) {
        if (isFailedPaymentEvent(event)) {
          try {
            await syncSubscriptionFromProvider(paymentEntity.subscription_id);
          } catch (error: any) {
            logger.warn('Failed to sync subscription after failed Razorpay payment event', { error: error.message });
          }
        }

        if (isSuccessfulPaymentEvent(event) || isFailedPaymentEvent(event)) {
          const paymentStatus = classifyPaymentEvent(event)!;

        await prisma.premiumSubscriptionPayment.upsert({
          where: { razorpayPaymentId: paymentEntity.id },
          update: {
            status: paymentStatus,
            amountPaise: paymentEntity.amount || existing.amountPaise,
            currency: paymentEntity.currency || CURRENCY,
            razorpayInvoiceId: paymentEntity.invoice_id || null,
            rawPayload: JSON.stringify(payload),
            paidAt: isFailedPaymentEvent(event) ? null : new Date(),
            failureReason: paymentEntity.error_description || null,
          },
          create: {
            premiumSubscriptionId: existing.id,
            status: paymentStatus,
            amountPaise: paymentEntity.amount || existing.amountPaise,
            currency: paymentEntity.currency || CURRENCY,
            razorpayPaymentId: paymentEntity.id,
            razorpayInvoiceId: paymentEntity.invoice_id || null,
            rawPayload: JSON.stringify(payload),
            paidAt: isFailedPaymentEvent(event) ? null : new Date(),
            failureReason: paymentEntity.error_description || null,
          },
        });
        }
      }
    }

    return res.json({ received: true });
  } catch (error: any) {
    logger.error('Razorpay webhook handling failed', { error: error.message });
    return res.status(500).json({ error: 'Webhook handling failed' });
  }
}

router.use(authenticate);

router.get('/status', authorize('SUPER_ADMIN', ...FINANCIAL_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const societyId = req.user?.societyId;
    if (!societyId) {
      return res.status(400).json({ error: 'No society linked to your account' });
    }

    const activeSubscription = await prisma.premiumSubscription.findFirst({
      where: { societyId, status: 'ACTIVE', razorpaySubscriptionId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });

    if (activeSubscription?.razorpaySubscriptionId) {
      try {
        await syncSubscriptionFromProvider(activeSubscription.razorpaySubscriptionId);
      } catch (error: any) {
        logger.warn('Failed to refresh premium status from Razorpay', { error: error.message, societyId });
      }
    }

    await ensurePremiumLifecycleForSociety(societyId);

    return res.json(await getStatusPayload(societyId));
  } catch (error: any) {
    logger.error('Failed to fetch premium status', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch premium status' });
  }
});

router.post(
  '/subscribe',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [body('requestedFlatCount').optional().isInt({ min: 1 })],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      requireRazorpayConfig();

      const societyId = req.user?.societyId;
      if (!societyId) {
        return res.status(400).json({ error: 'No society linked to your account' });
      }

      const activeSubscription = await prisma.premiumSubscription.findFirst({
        where: { societyId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      });

      if (activeSubscription?.razorpaySubscriptionId) {
        return res.status(409).json({
          error: 'Premium subscription is already active',
          code: 'PREMIUM_ALREADY_ACTIVE',
          status: await getStatusPayload(societyId),
        });
      }

      const currentFlatCount = await getCurrentFlatCount(societyId);
      const minimumRequiredFlatCount = getMinimumRequiredFlatCount(currentFlatCount, FREE_TIER_FLAT_LIMIT, false);
      const requestedFlatCount = req.body.requestedFlatCount ? Number(req.body.requestedFlatCount) : minimumRequiredFlatCount;
      const effectiveFlatCount = Math.max(requestedFlatCount, minimumRequiredFlatCount);
      const amountPaise = effectiveFlatCount * PRICE_PER_FLAT_PAISE;

      if (currentFlatCount <= 0 || amountPaise <= 0) {
        return res.status(400).json({ error: 'At least one flat is required before starting Premium' });
      }

      if (requestedFlatCount < minimumRequiredFlatCount) {
        return res.status(400).json({
          error: `Please choose at least ${minimumRequiredFlatCount} flats for Premium.`,
          code: 'INVALID_PREMIUM_FLAT_COUNT',
        });
      }

      const pendingSubscription = await prisma.premiumSubscription.findFirst({
        where: { societyId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });

      if (pendingSubscription?.razorpaySubscriptionId && pendingSubscription.lockedFlatCount === effectiveFlatCount) {
        let shouldReusePendingSubscription = false;

        try {
          const syncResult = await syncSubscriptionFromProvider(pendingSubscription.razorpaySubscriptionId);

          if (syncResult) {
            if (ACTIVE_STATUSES.has(syncResult.update.status)) {
              return res.status(409).json({
                error: 'Premium subscription is already active',
                code: 'PREMIUM_ALREADY_ACTIVE',
                status: await getStatusPayload(societyId),
              });
            }

            if (isReusablePendingSubscriptionStatus(syncResult.update.status)) {
              shouldReusePendingSubscription = true;
            }
          }
        } catch (error: any) {
          logger.warn('Failed to refresh pending Razorpay subscription before reuse', { error: error.message });
          shouldReusePendingSubscription = true;
        }

        if (shouldReusePendingSubscription) {
          return res.json({
            keyId: config.razorpay.keyId,
            subscriptionId: pendingSubscription.razorpaySubscriptionId,
            amountPaise: pendingSubscription.amountPaise,
            amountPerFlatPaise: pendingSubscription.amountPerFlatPaise,
            lockedFlatCount: pendingSubscription.lockedFlatCount,
            includedFlatCount: pendingSubscription.includedFlatCount,
            currency: pendingSubscription.currency,
            minimumRequiredFlatCount,
            message: buildSubscriptionMessage(
              pendingSubscription.lockedFlatCount,
              pendingSubscription.includedFlatCount,
              pendingSubscription.scheduledFlatCount,
            ),
          });
        }
      }

      const plan = await createRazorpayPlan(effectiveFlatCount, amountPaise);
      const subscription = await createRazorpaySubscription(plan.id, societyId, effectiveFlatCount);

      await prisma.premiumSubscription.create({
        data: {
          societyId,
          status: mapProviderStatus(subscription.status),
          providerStatus: subscription.status || null,
          lockedFlatCount: effectiveFlatCount,
          includedFlatCount: effectiveFlatCount,
          amountPerFlatPaise: PRICE_PER_FLAT_PAISE,
          amountPaise,
          currency: CURRENCY,
          razorpayPlanId: plan.id,
          razorpaySubscriptionId: subscription.id || null,
          usesPerFlatQuantity: false,
          startDate: toDate(subscription.start_at),
          currentPeriodStart: toDate(subscription.current_start),
          currentPeriodEnd: toDate(subscription.current_end),
          nextBillingAt: toDate(subscription.charge_at),
          expiresAt: toDate(subscription.end_at),
          notes: buildSubscriptionMessage(effectiveFlatCount),
        },
      });

      return res.json({
        keyId: config.razorpay.keyId,
        subscriptionId: subscription.id,
        amountPaise,
        amountPerFlatPaise: PRICE_PER_FLAT_PAISE,
        lockedFlatCount: effectiveFlatCount,
        includedFlatCount: effectiveFlatCount,
        currency: CURRENCY,
        minimumRequiredFlatCount,
        message: buildSubscriptionMessage(effectiveFlatCount),
      });
    } catch (error: any) {
      logger.error('Failed to create premium subscription', {
        error: error.message,
      });
      return res.status(500).json({
        error: error.message === 'Razorpay is not configured on the server'
          ? error.message
          : 'Failed to create premium subscription',
      });
    }
  },
);

router.post(
  '/upgrade',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [body('requestedFlatCount').isInt({ min: 1 })],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      requireRazorpayConfig();

      const societyId = req.user?.societyId;
      if (!societyId) {
        return res.status(400).json({ error: 'No society linked to your account' });
      }

      const activeSubscription = await prisma.premiumSubscription.findFirst({
        where: { societyId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      });

      if (!activeSubscription?.razorpaySubscriptionId) {
        return res.status(400).json({
          error: 'Premium is not active for this society yet',
          code: 'PREMIUM_NOT_ACTIVE',
        });
      }

      const syncedSubscription = await syncSubscriptionFromProvider(activeSubscription.razorpaySubscriptionId);
      const latestActive = syncedSubscription?.updated || activeSubscription;
      const currentFlatCount = await getCurrentFlatCount(societyId);
      const minimumRequiredFlatCount = getMinimumRequiredFlatCount(currentFlatCount, latestActive.includedFlatCount, true);
      const requestedFlatCount = Number(req.body.requestedFlatCount);

      if (requestedFlatCount < minimumRequiredFlatCount) {
        return res.status(400).json({
          error: `Please choose at least ${minimumRequiredFlatCount} flats to increase your Premium capacity.`,
          code: 'INVALID_PREMIUM_FLAT_COUNT',
        });
      }

      const remoteSubscription = await fetchRazorpaySubscription(latestActive.razorpaySubscriptionId!);
      const plan = await createRazorpayPlan(requestedFlatCount, requestedFlatCount * PRICE_PER_FLAT_PAISE);
      const updatedSubscription = await updateRazorpaySubscription(latestActive.razorpaySubscriptionId!, {
        planId: plan.id,
        quantity: 1,
        remainingCount: parseRemainingCount(remoteSubscription.remaining_count),
        scheduleChangeAt: 'cycle_end',
        notes: {
          societyId,
          lockedFlatCount: String(requestedFlatCount),
        },
      });

      let pendingUpdate: RazorpaySubscriptionEntity | null = null;
      if (updatedSubscription.has_scheduled_changes) {
        try {
          pendingUpdate = await fetchRazorpayPendingSubscriptionUpdate(latestActive.razorpaySubscriptionId!);
        } catch (error: any) {
          logger.warn('Failed to fetch scheduled premium upgrade details', { error: error.message, societyId });
        }
      }

      await prisma.premiumSubscription.update({
        where: { id: latestActive.id },
        data: {
          includedFlatCount: requestedFlatCount,
          scheduledFlatCount: requestedFlatCount,
          scheduledAmountPaise: requestedFlatCount * PRICE_PER_FLAT_PAISE,
          scheduledChangeAt: getScheduledChangeDate(pendingUpdate || updatedSubscription),
          scheduledPlanId: plan.id,
          notes: buildSubscriptionMessage(latestActive.lockedFlatCount, requestedFlatCount, requestedFlatCount),
        },
      });

      return res.json({
        success: true,
        scheduled: true,
        status: await getStatusPayload(societyId),
      });
    } catch (error: any) {
      logger.error('Failed to schedule premium capacity upgrade', { error: error.message });
      return res.status(500).json({ error: 'Failed to schedule premium capacity upgrade' });
    }
  },
);

router.post(
  '/verify',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [
    body('razorpay_payment_id').trim().notEmpty(),
    body('razorpay_subscription_id').trim().notEmpty(),
    body('razorpay_signature').trim().notEmpty(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      requireRazorpayConfig();

      const societyId = req.user?.societyId;
      if (!societyId) {
        return res.status(400).json({ error: 'No society linked to your account' });
      }

      const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;
      const expectedSignature = crypto
        .createHmac('sha256', config.razorpay.keySecret)
        .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
        .digest('hex');

      if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({ error: 'Invalid Razorpay signature' });
      }

      const localSubscription = await prisma.premiumSubscription.findFirst({
        where: { societyId, razorpaySubscriptionId: razorpay_subscription_id },
      });

      if (!localSubscription) {
        return res.status(404).json({ error: 'Premium subscription not found' });
      }

      let remoteSubscription: RazorpaySubscriptionEntity | null = null;
      try {
        remoteSubscription = await fetchRazorpaySubscription(razorpay_subscription_id);
      } catch (error: any) {
        logger.warn('Failed to fetch Razorpay subscription during verify', { error: error.message });
      }

      const update = remoteSubscription ? buildSubscriptionUpdate(remoteSubscription, localSubscription) : {
        status: PremiumSubscriptionStatus.ACTIVE,
        providerStatus: 'verified',
        lockedFlatCount: localSubscription.lockedFlatCount,
        includedFlatCount: localSubscription.includedFlatCount,
        amountPaise: localSubscription.amountPaise,
        usesPerFlatQuantity: localSubscription.usesPerFlatQuantity,
        scheduledFlatCount: localSubscription.scheduledFlatCount,
        scheduledAmountPaise: localSubscription.scheduledAmountPaise,
        scheduledChangeAt: localSubscription.scheduledChangeAt,
        scheduledPlanId: localSubscription.scheduledPlanId,
        startDate: localSubscription.startDate,
        currentPeriodStart: localSubscription.currentPeriodStart,
        currentPeriodEnd: localSubscription.currentPeriodEnd,
        nextBillingAt: localSubscription.nextBillingAt,
        expiresAt: localSubscription.expiresAt,
        cancelledAt: null,
        notes: buildSubscriptionMessage(
          localSubscription.lockedFlatCount,
          localSubscription.includedFlatCount,
          localSubscription.scheduledFlatCount,
        ),
      };

      await prisma.$transaction(async (tx) => {
        await tx.premiumSubscription.update({
          where: { id: localSubscription.id },
          data: update,
        });

        await tx.premiumSubscriptionPayment.upsert({
          where: { razorpayPaymentId: razorpay_payment_id },
          update: {
            status: PaymentStatus.SUCCESS,
            amountPaise: localSubscription.amountPaise,
            currency: localSubscription.currency,
            rawPayload: JSON.stringify(req.body),
            paidAt: new Date(),
          },
          create: {
            premiumSubscriptionId: localSubscription.id,
            status: PaymentStatus.SUCCESS,
            amountPaise: localSubscription.amountPaise,
            currency: localSubscription.currency,
            razorpayPaymentId: razorpay_payment_id,
            rawPayload: JSON.stringify(req.body),
            paidAt: new Date(),
          },
        });

        await tx.society.update({
          where: { id: societyId },
          data: {
            isPremium: isPremiumEntitlementStatus(update.status),
            hadPremiumSubscription: true,
          },
        });
      });

      await ensurePremiumLifecycleForSociety(societyId);

      return res.json({
        success: true,
        status: await getStatusPayload(societyId),
      });
    } catch (error: any) {
      logger.error('Failed to verify premium subscription payment', { error: error.message });
      return res.status(500).json({ error: 'Failed to verify premium subscription payment' });
    }
  },
);

export default router;