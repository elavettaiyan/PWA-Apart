import crypto from 'crypto';
import { Response, Router } from 'express';
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
import {
  buildSubscriptionMessage,
  buildSubscriptionUpdate,
  classifyPaymentEvent,
  computeTrialStatus,
  CURRENCY,
  FREE_TIER_FLAT_LIMIT,
  getMinimumRequiredFlatCount,
  getScheduledChangeDate,
  isFailedPaymentEvent,
  isPremiumEntitlementStatus,
  isReusablePendingSubscriptionStatus,
  isSuccessfulPaymentEvent,
  mapProviderStatus,
  parseRemainingCount,
  PRICE_PER_FLAT_PAISE,
  RazorpaySubscriptionEntity,
  toDate,
} from './service';
import { subscribeValidation, upgradeValidation, verifyPremiumPaymentValidation } from './validation';

export {
  buildSubscriptionUpdate,
  classifyPaymentEvent,
  computeTrialStatus,
  getMinimumRequiredFlatCount,
  isPremiumEntitlementStatus,
  isReusablePendingSubscriptionStatus,
  mapProviderStatus,
  TRIAL_DAYS,
  TRIAL_FLAT_LIMIT,
} from './service';

const router = Router();

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
      select: { id: true, isPremium: true, isActive: true, hadPremiumSubscription: true, name: true, trialStartedAt: true, trialEndsAt: true, premiumOverrideUntil: true },
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

  const trial = computeTrialStatus(society?.trialStartedAt, society?.trialEndsAt);

  // Check if super admin has manually granted premium via override.
  // Override takes precedence over both Razorpay subscription and trial status.
  const now = new Date();
  const isPremiumOverrideActive = society?.premiumOverrideUntil ? society.premiumOverrideUntil > now : false;

  const effectiveIsPremium = isPremiumOverrideActive || (society?.isPremium ?? false);
  const effectiveActiveSubscription = isPremiumOverrideActive ? null : activeSubscription;

  const effectiveFreeCap = trial.flatLimit;
  const includedFlatCount = effectiveActiveSubscription?.includedFlatCount || effectiveFreeCap;
  const minimumRequiredFlatCount = getMinimumRequiredFlatCount(currentFlatCount, includedFlatCount, !!effectiveActiveSubscription);
  const limitReached = !!effectiveActiveSubscription
    ? currentFlatCount >= includedFlatCount
    : currentFlatCount >= effectiveFreeCap;
  const limitReason = !!effectiveActiveSubscription
    ? limitReached
      ? 'PREMIUM_CAPACITY'
      : 'NONE'
    : limitReached
      ? (trial.isOnTrial ? 'TRIAL_FLAT_LIMIT' : (isPremiumOverrideActive ? 'NONE' : 'FREE_TIER'))
      : 'NONE';
  const previewLockedFlatCount = effectiveActiveSubscription?.scheduledFlatCount || effectiveActiveSubscription?.lockedFlatCount || minimumRequiredFlatCount;
  const previewAmountPaise = previewLockedFlatCount * PRICE_PER_FLAT_PAISE;
  const lifecycle = !effectiveActiveSubscription && latestSubscription && society?.hadPremiumSubscription
    ? calculatePremiumLifecycle(latestSubscription.overdueStartedAt)
    : calculatePremiumLifecycle(null);
  const lifecycleMessage = buildPremiumLifecycleMessage(lifecycle);

  return {
    isPremium: effectiveIsPremium,
    isArchived: !society?.isActive,
    premiumOverride: {
      isActive: isPremiumOverrideActive,
      until: society?.premiumOverrideUntil ?? null,
    },
    trial: {
      isOnTrial: trial.isOnTrial,
      isExpired: trial.isExpired,
      trialStartedAt: trial.trialStartedAt,
      trialEndsAt: trial.trialEndsAt,
      daysRemaining: trial.daysRemaining,
      flatLimit: trial.flatLimit,
    },
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
        effectiveActiveSubscription?.lockedFlatCount || previewLockedFlatCount,
        effectiveActiveSubscription?.includedFlatCount || includedFlatCount,
        effectiveActiveSubscription?.scheduledFlatCount,
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
    activeSubscription: effectiveActiveSubscription,
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
  subscribeValidation,
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
            if (isPremiumEntitlementStatus(syncResult.update.status)) {
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
  upgradeValidation,
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
  verifyPremiumPaymentValidation,
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