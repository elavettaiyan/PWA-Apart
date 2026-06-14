import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../../config/database';
import { allocatePayment, computeAndApplyLateFees } from './service';

describe('Collections service', () => {
  let societyId: string;
  let blockId: string;

  before(async () => {
    // Create minimal society/block fixtures
    const society = await prisma.society.create({ data: { name: `smoke-soc-${Date.now()}`, city: 'Test', state: 'TS', address: 'addr', pincode: '000000' } });
    societyId = society.id;
    const block = await prisma.block.create({ data: { name: 'A', societyId: societyId } });
    blockId = block.id;
  });

  after(async () => {
    // Cleanup
    if (societyId) {
      await prisma.society.deleteMany({ where: { id: societyId } });
    }
  });

  it('computeAndApplyLateFees should compute lateFee and mark overdue', async () => {
    // create a flat and a config with lateFeePerDay for this test
    const flat = await prisma.flat.create({ data: { flatNumber: `T-late-${Date.now()}`, blockId, type: 'TWO_BHK', floor: 1 } as any });
    const fid = flat.id;
    await prisma.maintenanceConfig.create({ data: { societyId, flatType: 'TWO_BHK', baseAmount: 0, lateFeePerDay: 10, dueDay: 1, effectiveFrom: new Date(), isActive: true } as any });

    // create a bill overdue by 3 days
    const dueDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const bill = await prisma.maintenanceBill.create({ data: { flatId: fid, month: 1, year: 2020, baseAmount: 100, totalAmount: 100, dueDate, paidAmount: 0 } as any });

    const updated = await computeAndApplyLateFees(societyId);
    assert.ok(updated >= 1, 'Expected at least one bill updated');

    const refreshed = await prisma.maintenanceBill.findUnique({ where: { id: bill.id } });
    assert.ok(refreshed);
    // lateFee = 3 * 10 = 30
    assert.strictEqual(Number(refreshed!.lateFee.toFixed(2)), 30);
    assert.strictEqual(Number(refreshed!.totalAmount.toFixed(2)), 130);
    assert.strictEqual(refreshed!.status, 'OVERDUE');
  });

  it('allocatePayment should apply amount oldest-first and create no advance when exact', async () => {
    // create a separate flat for this test and two bills for it
    const flat = await prisma.flat.create({ data: { flatNumber: `T-alloc-${Date.now()}`, blockId, type: 'TWO_BHK', floor: 1 } as any });
    const fid = flat.id;
    const bill1 = await prisma.maintenanceBill.create({ data: { flatId: fid, month: 2, year: 2020, baseAmount: 100, totalAmount: 100, paidAmount: 0, dueDate: new Date() } as any });
    const bill2 = await prisma.maintenanceBill.create({ data: { flatId: fid, month: 3, year: 2020, baseAmount: 150, totalAmount: 150, paidAmount: 0, dueDate: new Date() } as any });

    const res = await allocatePayment(fid, 180);
    // Expect bill1 paid fully (100) and bill2 partially (80)
    const b1 = await prisma.maintenanceBill.findUnique({ where: { id: bill1.id } });
    const b2 = await prisma.maintenanceBill.findUnique({ where: { id: bill2.id } });

    assert.strictEqual(Number(b1!.paidAmount.toFixed(2)), 100);
    assert.strictEqual(b1!.status, 'PAID');
    assert.strictEqual(Number(b2!.paidAmount.toFixed(2)), 80);
    assert.strictEqual(b2!.status, 'PARTIAL');
    assert.strictEqual(res.remaining, 0);

    // No advance balance expected
    const adv = await prisma.advanceBalance.findFirst({ where: { flatId: fid } });
    assert.strictEqual(adv, null);
  });
});
