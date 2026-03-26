import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentStatus, PremiumSubscriptionStatus } from '@prisma/client';
import {
  buildSubscriptionUpdate,
  classifyPaymentEvent,
  getMinimumRequiredFlatCount,
  isPremiumEntitlementStatus,
  isReusablePendingSubscriptionStatus,
  mapProviderStatus,
} from './routes';

describe('premium routes helpers', () => {
  it('grants entitlement only for active subscriptions', () => {
    assert.equal(isPremiumEntitlementStatus(PremiumSubscriptionStatus.ACTIVE), true);
    assert.equal(isPremiumEntitlementStatus(PremiumSubscriptionStatus.PENDING), false);
    assert.equal(isPremiumEntitlementStatus(PremiumSubscriptionStatus.HALTED), false);
    assert.equal(isPremiumEntitlementStatus(PremiumSubscriptionStatus.CANCELLED), false);
    assert.equal(isPremiumEntitlementStatus(PremiumSubscriptionStatus.FAILED), false);
  });

  it('reuses only pending subscriptions', () => {
    assert.equal(isReusablePendingSubscriptionStatus(PremiumSubscriptionStatus.PENDING), true);
    assert.equal(isReusablePendingSubscriptionStatus(PremiumSubscriptionStatus.ACTIVE), false);
    assert.equal(isReusablePendingSubscriptionStatus(PremiumSubscriptionStatus.CANCELLED), false);
  });

  it('classifies only explicit payment success and failure events', () => {
    assert.equal(classifyPaymentEvent('payment.captured'), PaymentStatus.SUCCESS);
    assert.equal(classifyPaymentEvent('payment.failed'), PaymentStatus.FAILED);
    assert.equal(classifyPaymentEvent('payment.authorized'), null);
    assert.equal(classifyPaymentEvent('payment.created'), null);
    assert.equal(classifyPaymentEvent(undefined), null);
  });

  it('maps provider status values conservatively', () => {
    assert.equal(mapProviderStatus('active'), PremiumSubscriptionStatus.ACTIVE);
    assert.equal(mapProviderStatus('authenticated'), PremiumSubscriptionStatus.ACTIVE);
    assert.equal(mapProviderStatus('pending'), PremiumSubscriptionStatus.PENDING);
    assert.equal(mapProviderStatus('halted'), PremiumSubscriptionStatus.HALTED);
    assert.equal(mapProviderStatus('cancelled'), PremiumSubscriptionStatus.CANCELLED);
    assert.equal(mapProviderStatus('completed'), PremiumSubscriptionStatus.COMPLETED);
    assert.equal(mapProviderStatus('unknown-status'), PremiumSubscriptionStatus.FAILED);
  });

  it('does not treat pending provider updates as active entitlement', () => {
    const update = buildSubscriptionUpdate({
      status: 'pending',
      current_start: 1710000000,
      current_end: 1712592000,
      charge_at: 1712592000,
    });

    assert.equal(update.status, PremiumSubscriptionStatus.PENDING);
    assert.equal(isPremiumEntitlementStatus(update.status), false);
    assert.equal(update.currentPeriodStart?.toISOString(), new Date(1710000000 * 1000).toISOString());
    assert.equal(update.currentPeriodEnd?.toISOString(), new Date(1712592000 * 1000).toISOString());
  });

  it('requires one more flat when the free tier limit is reached', () => {
    assert.equal(getMinimumRequiredFlatCount(5, 5, false), 6);
    assert.equal(getMinimumRequiredFlatCount(8, 5, false), 9);
  });

  it('requires capacity above the included premium flat count', () => {
    assert.equal(getMinimumRequiredFlatCount(8, 10, true), 11);
    assert.equal(getMinimumRequiredFlatCount(10, 10, true), 11);
  });

  it('tracks scheduled cycle-end upgrades without changing current billed flat count', () => {
    const update = buildSubscriptionUpdate(
      {
        status: 'active',
        plan_id: 'plan_current',
        quantity: 1,
        has_scheduled_changes: true,
        current_start: 1710000000,
        current_end: 1712592000,
        change_scheduled_at: 1712592000,
      },
      {
        amountPerFlatPaise: 1500,
        lockedFlatCount: 6,
        includedFlatCount: 6,
        usesPerFlatQuantity: false,
        scheduledPlanId: 'plan_next',
      },
      {
        plan_id: 'plan_next',
        quantity: 10,
        change_scheduled_at: 1712592000,
      },
    );

    assert.equal(update.lockedFlatCount, 6);
    assert.equal(update.includedFlatCount, 10);
    assert.equal(update.scheduledFlatCount, 10);
    assert.equal(update.scheduledAmountPaise, 15000);
  });
});