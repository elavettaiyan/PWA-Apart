import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentStatus, PremiumSubscriptionStatus } from '@prisma/client';
import {
  buildSubscriptionUpdate,
  classifyPaymentEvent,
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
});