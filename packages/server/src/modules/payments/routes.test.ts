import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  buildMaintenanceRazorpayWebhookEventKey,
  classifyMaintenanceRazorpayProviderStatus,
  classifyMaintenanceRazorpayWebhookEvent,
  verifyMaintenanceRazorpayWebhookSignature,
} from './routes';

describe('payments routes Razorpay maintenance helpers', () => {
  it('classifies verify/status provider states conservatively', () => {
    assert.equal(classifyMaintenanceRazorpayProviderStatus('captured'), 'SUCCESS');
    assert.equal(classifyMaintenanceRazorpayProviderStatus('authorized'), 'SUCCESS');
    assert.equal(classifyMaintenanceRazorpayProviderStatus('failed'), 'FAILED');
    assert.equal(classifyMaintenanceRazorpayProviderStatus('created'), null);
    assert.equal(classifyMaintenanceRazorpayProviderStatus(undefined), null);
  });

  it('classifies only terminal maintenance webhook events', () => {
    assert.equal(classifyMaintenanceRazorpayWebhookEvent('payment.captured'), 'SUCCESS');
    assert.equal(classifyMaintenanceRazorpayWebhookEvent('payment.authorized'), 'SUCCESS');
    assert.equal(classifyMaintenanceRazorpayWebhookEvent('payment.failed'), 'FAILED');
    assert.equal(classifyMaintenanceRazorpayWebhookEvent('payment.created'), null);
    assert.equal(classifyMaintenanceRazorpayWebhookEvent(undefined), null);
  });

  it('builds stable webhook idempotency keys from event and provider references', () => {
    assert.equal(
      buildMaintenanceRazorpayWebhookEventKey('payment.captured', 'order_123', 'pay_123'),
      'payment.captured:order_123:pay_123',
    );
    assert.equal(
      buildMaintenanceRazorpayWebhookEventKey(undefined, undefined, 'pay_123'),
      'unknown:no-order:pay_123',
    );
  });

  it('verifies Razorpay maintenance webhook signatures using the raw body', () => {
    const rawBody = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_123' } } } }));
    const secret = 'whsec_test_secret';
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    assert.equal(verifyMaintenanceRazorpayWebhookSignature(rawBody, signature, secret), true);
    assert.equal(verifyMaintenanceRazorpayWebhookSignature(rawBody, 'invalid-signature', secret), false);
  });
});
