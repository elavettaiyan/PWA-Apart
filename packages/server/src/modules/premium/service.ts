import { PaymentStatus, PremiumSubscriptionStatus } from '@prisma/client';

export const PRICE_PER_FLAT_PAISE = 2000;
export const CURRENCY = 'INR';
export const FREE_TIER_FLAT_LIMIT = 5;
export const TRIAL_DAYS = 30;
export const TRIAL_FLAT_LIMIT = 50;

const ACTIVE_STATUSES = new Set<PremiumSubscriptionStatus>(['ACTIVE']);
const REUSABLE_PENDING_STATUSES = new Set<PremiumSubscriptionStatus>(['PENDING']);
const SUCCESSFUL_PAYMENT_EVENTS = new Set(['payment.captured']);
const FAILED_PAYMENT_EVENTS = new Set(['payment.failed']);

export type RazorpaySubscriptionEntity = {
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

export function toDate(value?: number | null) {
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

export function buildSubscriptionMessage(
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

export type TrialStatus = {
  isOnTrial: boolean;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  daysRemaining: number;
  isExpired: boolean;
  flatLimit: number;
};

export function computeTrialStatus(trialStartedAt?: Date | null, trialEndsAt?: Date | null, now = new Date()): TrialStatus {
  if (!trialStartedAt || !trialEndsAt) {
    return { isOnTrial: false, trialStartedAt: null, trialEndsAt: null, daysRemaining: 0, isExpired: false, flatLimit: FREE_TIER_FLAT_LIMIT };
  }

  const isExpired = now >= trialEndsAt;
  const msRemaining = Math.max(trialEndsAt.getTime() - now.getTime(), 0);
  const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));

  return {
    isOnTrial: !isExpired,
    trialStartedAt,
    trialEndsAt,
    daysRemaining,
    isExpired,
    flatLimit: isExpired ? FREE_TIER_FLAT_LIMIT : TRIAL_FLAT_LIMIT,
  };
}

export function getScheduledChangeDate(entity?: RazorpaySubscriptionEntity | null) {
  return toDate(entity?.change_scheduled_at ?? entity?.current_end ?? entity?.charge_at);
}

export function parseRemainingCount(value?: number | string | null) {
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

export function isSuccessfulPaymentEvent(event?: string) {
  return !!event && SUCCESSFUL_PAYMENT_EVENTS.has(event);
}

export function isFailedPaymentEvent(event?: string) {
  return !!event && FAILED_PAYMENT_EVENTS.has(event);
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