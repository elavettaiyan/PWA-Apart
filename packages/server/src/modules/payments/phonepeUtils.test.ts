import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { calculateBillPaymentUpdate, generateChecksum, verifyCallbackChecksum } from './phonepeUtils';

describe('phonepeUtils', () => {
  it('generates deterministic checksum for pay endpoint', () => {
    const checksum = generateChecksum('payload-base64', '/pg/v1/pay', 'salt', 1);
    const expectedHash = crypto.createHash('sha256').update('payload-base64/pg/v1/paysalt').digest('hex');
    assert.equal(checksum, `${expectedHash}###1`);
  });

  it('verifies callback checksum using canonical format (response + saltKey)', () => {
    const response = Buffer.from(JSON.stringify({ code: 'PAYMENT_SUCCESS' })).toString('base64');
    const canonical = `${crypto.createHash('sha256').update(response + 'salt').digest('hex')}###1`;

    assert.equal(verifyCallbackChecksum(response, canonical, 'salt', 1), true);
  });

  it('verifies callback checksum using legacy format (response + endpoint + saltKey)', () => {
    const response = Buffer.from(JSON.stringify({ code: 'PAYMENT_SUCCESS' })).toString('base64');
    const legacy = generateChecksum(response, '/pg/v1/pay', 'salt', 1);

    assert.equal(verifyCallbackChecksum(response, legacy, 'salt', 1), true);
  });

  it('rejects invalid callback checksum', () => {
    const response = Buffer.from(JSON.stringify({ code: 'PAYMENT_SUCCESS' })).toString('base64');
    assert.equal(verifyCallbackChecksum(response, 'bad###1', 'salt', 1), false);
  });

  it('returns PARTIAL when paid amount remains below total', () => {
    const result = calculateBillPaymentUpdate(1000, 5000, 500);
    assert.equal(result.newPaidAmount, 1500);
    assert.equal(result.newStatus, 'PARTIAL');
  });

  it('returns PAID when paid amount reaches total', () => {
    const result = calculateBillPaymentUpdate(3000, 5000, 2000);
    assert.equal(result.newPaidAmount, 5000);
    assert.equal(result.newStatus, 'PAID');
  });

  it('returns PAID when paid amount exceeds total', () => {
    const result = calculateBillPaymentUpdate(4500, 5000, 1000);
    assert.equal(result.newPaidAmount, 5500);
    assert.equal(result.newStatus, 'PAID');
  });
});
