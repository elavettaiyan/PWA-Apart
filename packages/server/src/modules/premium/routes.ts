import crypto from 'crypto';
import axios from 'axios';
import { Response, Router } from 'express';
import { body } from 'express-validator';
import { PaymentStatus, PremiumSubscriptionStatus } from '@prisma/client';
import { config } from '../../config';
import prisma, { dbReady } from '../../config/database';
import logger from '../../config/logger';
import { authenticate, authorize, AuthRequest, SOCIETY_MANAGERS } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';

const router = Router();

const PRICE_PER_FLAT_PAISE = 1500;
const CURRENCY = 'INR';
const ACTIVE_STATUSES = new Set<PremiumSubscriptionStatus>(['ACTIVE']);

type RazorpaySubscriptionEntity = {
  id?: string;
  status?: string;
  current_start?: number;
  current_end?: number;
  charge_at?: number;
  start_at?: number;
  end_at?: number;
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

function mapProviderStatus(status?: string | null): PremiumSubscriptionStatus {
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

function buildSubscriptionMessage(lockedFlatCount: number) {
  return `Your Premium subscription amount is locked at ${lockedFlatCount} flats. Flats added later will not change the current subscription amount until a future plan update or renewal rule applies.`;
}

const razorpayApi = axios.create({
  baseURL: config.razorpay.baseUrl,
  auth: {
    username: config.razorpay.keyId,
    password: config.razorpay.keySecret,
  },
  headers: {
    'Content-Type': 'application/json',
  },
});

async function getCurrentFlatCount(societyId: string) {
  return prisma.flat.count({ where: { block: { societyId } } });
}

async function createRazorpayPlan(lockedFlatCount: number, amountPaise: number) {
  const response = await razorpayApi.post('/plans', {
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
    },
  });

  return response.data;
}

async function createRazorpaySubscription(planId: string, societyId: string, lockedFlatCount: number) {
  const response = await razorpayApi.post('/subscriptions', {
    plan_id: planId,
    total_count: config.razorpay.subscriptionCycles,
    quantity: 1,
    customer_notify: 1,
    notes: {
      societyId,
      lockedFlatCount: String(lockedFlatCount),
    },
  });

  return response.data as RazorpaySubscriptionEntity;
}

async function fetchRazorpaySubscription(subscriptionId: string) {
  const response = await razorpayApi.get(`/subscriptions/${subscriptionId}`);
  return response.data as RazorpaySubscriptionEntity;
}

function buildSubscriptionUpdate(entity: RazorpaySubscriptionEntity) {
  const mappedStatus = mapProviderStatus(entity.status);
  return {
    status: mappedStatus,
    providerStatus: entity.status || null,
    startDate: toDate(entity.start_at),
    currentPeriodStart: toDate(entity.current_start),
    currentPeriodEnd: toDate(entity.current_end),
    nextBillingAt: toDate(entity.charge_at),
    expiresAt: toDate(entity.end_at),
    cancelledAt: mappedStatus === 'CANCELLED' ? new Date() : null,
  };
}

async function syncSocietyPremiumFlag(societyId: string, status: PremiumSubscriptionStatus) {
  await prisma.society.update({
    where: { id: societyId },
    data: { isPremium: ACTIVE_STATUSES.has(status) },
  });
}

async function getStatusPayload(societyId: string) {
  const [society, currentFlatCount, activeSubscription, latestSubscription] = await Promise.all([
    prisma.society.findUnique({ where: { id: societyId }, select: { id: true, isPremium: true, name: true } }),
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

  const previewLockedFlatCount = activeSubscription?.lockedFlatCount || currentFlatCount;
  const previewAmountPaise = previewLockedFlatCount * PRICE_PER_FLAT_PAISE;

  return {
    isPremium: society?.isPremium ?? false,
    currentFlatCount,
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
      message: buildSubscriptionMessage(previewLockedFlatCount),
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
        const update = buildSubscriptionUpdate(subscriptionEntity);
        await prisma.premiumSubscription.update({ where: { id: existing.id }, data: update });
        await syncSocietyPremiumFlag(existing.societyId, update.status);
      }
    }

    if (paymentEntity?.subscription_id) {
      const existing = await prisma.premiumSubscription.findUnique({
        where: { razorpaySubscriptionId: paymentEntity.subscription_id },
      });

      if (existing) {
        await prisma.premiumSubscriptionPayment.upsert({
          where: { razorpayPaymentId: paymentEntity.id },
          update: {
            status: event === 'payment.failed' ? 'FAILED' : 'SUCCESS',
            amountPaise: paymentEntity.amount || existing.amountPaise,
            currency: paymentEntity.currency || CURRENCY,
            razorpayInvoiceId: paymentEntity.invoice_id || null,
            rawPayload: JSON.stringify(payload),
            paidAt: event === 'payment.failed' ? null : new Date(),
            failureReason: paymentEntity.error_description || null,
          },
          create: {
            premiumSubscriptionId: existing.id,
            status: event === 'payment.failed' ? PaymentStatus.FAILED : PaymentStatus.SUCCESS,
            amountPaise: paymentEntity.amount || existing.amountPaise,
            currency: paymentEntity.currency || CURRENCY,
            razorpayPaymentId: paymentEntity.id,
            razorpayInvoiceId: paymentEntity.invoice_id || null,
            rawPayload: JSON.stringify(payload),
            paidAt: event === 'payment.failed' ? null : new Date(),
            failureReason: paymentEntity.error_description || null,
          },
        });
      }
    }

    return res.json({ received: true });
  } catch (error: any) {
    logger.error('Razorpay webhook handling failed', { error: error.message });
    return res.status(500).json({ error: 'Webhook handling failed' });
  }
}

router.use(authenticate);
router.use(authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS));

router.get('/status', async (req: AuthRequest, res: Response) => {
  try {
    const societyId = req.user?.societyId;
    if (!societyId) {
      return res.status(400).json({ error: 'No society linked to your account' });
    }

    return res.json(await getStatusPayload(societyId));
  } catch (error: any) {
    logger.error('Failed to fetch premium status', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch premium status' });
  }
});

router.post('/subscribe', async (req: AuthRequest, res: Response) => {
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

    const pendingSubscription = await prisma.premiumSubscription.findFirst({
      where: { societyId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });

    if (pendingSubscription?.razorpaySubscriptionId) {
      return res.json({
        keyId: config.razorpay.keyId,
        subscriptionId: pendingSubscription.razorpaySubscriptionId,
        amountPaise: pendingSubscription.amountPaise,
        amountPerFlatPaise: pendingSubscription.amountPerFlatPaise,
        lockedFlatCount: pendingSubscription.lockedFlatCount,
        currency: pendingSubscription.currency,
        message: buildSubscriptionMessage(pendingSubscription.lockedFlatCount),
      });
    }

    const lockedFlatCount = await getCurrentFlatCount(societyId);
    const amountPaise = lockedFlatCount * PRICE_PER_FLAT_PAISE;

    if (lockedFlatCount <= 0 || amountPaise <= 0) {
      return res.status(400).json({ error: 'At least one flat is required before starting Premium' });
    }

    const plan = await createRazorpayPlan(lockedFlatCount, amountPaise);
    const subscription = await createRazorpaySubscription(plan.id, societyId, lockedFlatCount);

    await prisma.premiumSubscription.create({
      data: {
        societyId,
        status: mapProviderStatus(subscription.status),
        providerStatus: subscription.status || null,
        lockedFlatCount,
        amountPerFlatPaise: PRICE_PER_FLAT_PAISE,
        amountPaise,
        currency: CURRENCY,
        razorpayPlanId: plan.id,
        razorpaySubscriptionId: subscription.id || null,
        startDate: toDate(subscription.start_at),
        currentPeriodStart: toDate(subscription.current_start),
        currentPeriodEnd: toDate(subscription.current_end),
        nextBillingAt: toDate(subscription.charge_at),
        expiresAt: toDate(subscription.end_at),
        notes: buildSubscriptionMessage(lockedFlatCount),
      },
    });

    return res.json({
      keyId: config.razorpay.keyId,
      subscriptionId: subscription.id,
      amountPaise,
      amountPerFlatPaise: PRICE_PER_FLAT_PAISE,
      lockedFlatCount,
      currency: CURRENCY,
      message: buildSubscriptionMessage(lockedFlatCount),
    });
  } catch (error: any) {
    logger.error('Failed to create premium subscription', {
      error: error.response?.data || error.message,
    });
    return res.status(500).json({
      error: error.message === 'Razorpay is not configured on the server'
        ? error.message
        : 'Failed to create premium subscription',
    });
  }
});

router.post(
  '/verify',
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

      const update = remoteSubscription ? buildSubscriptionUpdate(remoteSubscription) : {
        status: PremiumSubscriptionStatus.ACTIVE,
        providerStatus: 'verified',
        startDate: localSubscription.startDate,
        currentPeriodStart: localSubscription.currentPeriodStart,
        currentPeriodEnd: localSubscription.currentPeriodEnd,
        nextBillingAt: localSubscription.nextBillingAt,
        expiresAt: localSubscription.expiresAt,
        cancelledAt: null,
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
          data: { isPremium: true },
        });
      });

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