import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildResidentBillFilter, canResidentAccessBill } from './scope';

describe('billing scope helpers', () => {
  it('builds resident bill filter using flat IDs list', () => {
    const where = buildResidentBillFilter(['flat-1', 'flat-2']);
    assert.deepEqual(where, { flatId: { in: ['flat-1', 'flat-2'] } });
  });

  it('allows resident access only when bill flat belongs to resident', () => {
    assert.equal(canResidentAccessBill('flat-1', ['flat-1', 'flat-2']), true);
    assert.equal(canResidentAccessBill('flat-3', ['flat-1', 'flat-2']), false);
  });

  it('denies access when resident has no linked flat IDs', () => {
    assert.equal(canResidentAccessBill('flat-1', []), false);
  });
});
