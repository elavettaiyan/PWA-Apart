import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escapeCsvValue, parseCampaignHistoryRecord } from './crmService';

describe('admin CRM service helpers', () => {
  it('escapes CSV values only when needed', () => {
    assert.equal(escapeCsvValue('Plain Text'), 'Plain Text');
    assert.equal(escapeCsvValue('Apt, Block'), '"Apt, Block"');
    assert.equal(escapeCsvValue('He said "yes"'), '"He said ""yes"""');
    assert.equal(escapeCsvValue(null), '');
  });

  it('parses campaign history recipient JSON fields', () => {
    const parsed = parseCampaignHistoryRecord({
      id: 'history-1',
      requestedRecipients: '["a@example.com"]',
      resolvedRecipients: '["b@example.com"]',
      failedRecipients: null,
    });

    assert.deepEqual(parsed.requestedRecipients, ['a@example.com']);
    assert.deepEqual(parsed.resolvedRecipients, ['b@example.com']);
    assert.deepEqual(parsed.failedRecipients, []);
  });
});