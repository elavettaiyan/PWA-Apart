import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSocietyScopedUserPayload, detectClientMedium, normalizeAdminAssignmentType } from './service';

describe('auth service helpers', () => {
  it('normalizes admin assignment only for admin role', () => {
    assert.equal(normalizeAdminAssignmentType('ADMIN'), 'PRESIDENT');
    assert.equal(normalizeAdminAssignmentType('ADMIN', 'TEMPORARY'), 'TEMPORARY');
    assert.equal(normalizeAdminAssignmentType('SECRETARY', 'TEMPORARY'), null);
  });

  it('builds scoped payload from active membership and owner flat', () => {
    const adminAssignedAt = new Date('2026-01-01T00:00:00.000Z');
    const flat = { id: 'flat-1', block: { societyId: 'society-1' } };

    const payload = buildSocietyScopedUserPayload({
      user: {
        id: 'user-1',
        email: 'admin@example.com',
        name: 'Admin',
        phone: null,
        role: 'ADMIN',
        specialization: null,
        societyId: 'society-1',
        activeSocietyId: 'society-1',
        mustChangePassword: false,
        skipAccountDeletionVerification: true,
        owners: [{ flat, isActive: true }],
        tenants: [],
        societyMemberships: [{
          societyId: 'society-1',
          role: 'ADMIN',
          adminAssignmentType: 'TEMPORARY',
          adminAssignedAt,
          society: { id: 'society-1', name: 'Society One' },
        }],
      },
    });

    assert.equal(payload.role, 'ADMIN');
    assert.equal(payload.societyId, 'society-1');
    assert.equal(payload.flatRelation, 'OWNER');
    assert.equal(payload.canUseOwnerView, true);
    assert.equal(payload.isTemporaryAdmin, true);
    assert.equal(payload.skipAccountDeletionVerification, true);
    assert.deepEqual(payload.societies, [{ id: 'society-1', name: 'Society One', role: 'ADMIN', adminAssignmentType: 'TEMPORARY' }]);
  });

  it('detects client medium from explicit request first, then user-agent', () => {
    const androidReq = { get: (header: string) => header === 'user-agent' ? 'Mozilla Android' : '' } as any;
    const iosReq = { get: (header: string) => header === 'user-agent' ? 'iPhone Safari' : '' } as any;
    const webReq = { get: () => 'Mozilla Desktop' } as any;

    assert.equal(detectClientMedium(androidReq), 'android');
    assert.equal(detectClientMedium(iosReq), 'ios');
    assert.equal(detectClientMedium(webReq), 'web');
    assert.equal(detectClientMedium(androidReq, 'web'), 'web');
  });
});