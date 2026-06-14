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
    await prisma.maintenanceConfig.deleteMany({ where: { societyId, flatType: 'TWO_BHK' } });
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

  it('computeAndApplyLateFees should apply one-time late fee once after grace period', async () => {
    const flat = await prisma.flat.create({ data: { flatNumber: `T-once-${Date.now()}`, blockId, type: 'TWO_BHK', floor: 1 } as any });
    const fid = flat.id;

    await prisma.societySettings.upsert({
      where: { societyId },
      create: { societyId, lateFeeEnabled: true } as any,
      update: { lateFeeEnabled: true },
    });
    await prisma.maintenanceConfig.deleteMany({ where: { societyId, flatType: 'TWO_BHK' } });

    await prisma.maintenanceConfig.create({
      data: {
        societyId,
        flatType: 'TWO_BHK',
        baseAmount: 0,
        lateFeeMode: 'ONE_TIME_PER_BILL',
        lateFeeAmount: 200,
        gracePeriodDays: 5,
        dueDay: 1,
        effectiveFrom: new Date(),
        isActive: true,
      } as any,
    });

    const dueDate = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    const bill = await prisma.maintenanceBill.create({ data: { flatId: fid, month: 2, year: 2020, baseAmount: 2000, totalAmount: 2000, dueDate, paidAmount: 0 } as any });

    await computeAndApplyLateFees(societyId);
    await computeAndApplyLateFees(societyId);

    const refreshed = await prisma.maintenanceBill.findUnique({ where: { id: bill.id } });
    assert.ok(refreshed);
    assert.strictEqual(Number(refreshed!.lateFee.toFixed(2)), 200);
    assert.strictEqual(Number(refreshed!.totalAmount.toFixed(2)), 2200);
    assert.strictEqual(refreshed!.status, 'OVERDUE');
  });

  it('computeAndApplyLateFees should not apply late fee before grace period ends', async () => {
    const flat = await prisma.flat.create({ data: { flatNumber: `T-grace-${Date.now()}`, blockId, type: 'TWO_BHK', floor: 1 } as any });
    const fid = flat.id;

    await prisma.societySettings.upsert({
      where: { societyId },
      create: { societyId, lateFeeEnabled: true } as any,
      update: { lateFeeEnabled: true },
    });
    await prisma.maintenanceConfig.deleteMany({ where: { societyId, flatType: 'TWO_BHK' } });

    await prisma.maintenanceConfig.create({
      data: {
        societyId,
        flatType: 'TWO_BHK',
        baseAmount: 0,
        lateFeeMode: 'ONE_TIME_PER_BILL',
        lateFeeAmount: 200,
        gracePeriodDays: 5,
        dueDay: 1,
        effectiveFrom: new Date(),
        isActive: true,
      } as any,
    });

    const dueDate = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    const bill = await prisma.maintenanceBill.create({ data: { flatId: fid, month: 3, year: 2020, baseAmount: 2000, totalAmount: 2000, dueDate, paidAmount: 0 } as any });

    await computeAndApplyLateFees(societyId);

    const refreshed = await prisma.maintenanceBill.findUnique({ where: { id: bill.id } });
    assert.ok(refreshed);
    assert.strictEqual(Number(refreshed!.lateFee.toFixed(2)), 0);
    assert.strictEqual(Number(refreshed!.totalAmount.toFixed(2)), 2000);
  });

  it('computeAndApplyLateFees should skip fees when late fee is disabled', async () => {
    const flat = await prisma.flat.create({ data: { flatNumber: `T-disabled-${Date.now()}`, blockId, type: 'TWO_BHK', floor: 1 } as any });
    const fid = flat.id;

    await prisma.societySettings.upsert({
      where: { societyId },
      create: { societyId, lateFeeEnabled: false } as any,
      update: { lateFeeEnabled: false },
    });
    await prisma.maintenanceConfig.deleteMany({ where: { societyId, flatType: 'TWO_BHK' } });

    await prisma.maintenanceConfig.create({
      data: {
        societyId,
        flatType: 'TWO_BHK',
        baseAmount: 0,
        lateFeeMode: 'PER_DAY',
        lateFeePerDay: 10,
        gracePeriodDays: 0,
        dueDay: 1,
        effectiveFrom: new Date(),
        isActive: true,
      } as any,
    });

    const dueDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const bill = await prisma.maintenanceBill.create({ data: { flatId: fid, month: 4, year: 2020, baseAmount: 100, totalAmount: 100, dueDate, paidAmount: 0 } as any });

    await computeAndApplyLateFees(societyId);

    const refreshed = await prisma.maintenanceBill.findUnique({ where: { id: bill.id } });
    assert.ok(refreshed);
    assert.strictEqual(Number(refreshed!.lateFee.toFixed(2)), 0);
    assert.strictEqual(Number(refreshed!.totalAmount.toFixed(2)), 100);
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
