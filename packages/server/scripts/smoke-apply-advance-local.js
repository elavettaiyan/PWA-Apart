#!/usr/bin/env node
/* Smoke test: create advance for a flat, generate a bill for given month/year locally (no HTTP),
   and verify advance is auto-applied when societySettings.autoAdjustAdvance is true. */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const flatId = process.argv[2];
  const month = parseInt(process.argv[3] || String(new Date().getMonth() + 1), 10);
  const year = parseInt(process.argv[4] || String(new Date().getFullYear()), 10);

  if (!flatId) {
    console.error('Usage: node smoke-apply-advance-local.js <flatId> [month] [year]');
    process.exit(1);
  }

  const flat = await prisma.flat.findUnique({ where: { id: flatId }, include: { block: { include: { society: true } } } });
  if (!flat) {
    console.error('Flat not found:', flatId);
    process.exit(1);
  }

  const societyId = flat.block.societyId;

  console.log('Flat:', flat.flatNumber, 'Society:', societyId);

  // Ensure society settings enable autoAdjustAdvance
  await prisma.societySettings.upsert({
    where: { societyId },
    create: { societyId, autoAdjustAdvance: true, lateFeeEnabled: true, partialPaymentAllowed: true, advancePaymentAllowed: true, forceOldestDueSettlement: true, manualBillSelection: false },
    update: { autoAdjustAdvance: true },
  });

  // Create or top-up advance balance
  const amount = 5000;
  const existingAdv = await prisma.advanceBalance.findFirst({ where: { flatId } });
  if (existingAdv) {
    await prisma.advanceBalance.update({ where: { id: existingAdv.id }, data: { amount: { set: amount } } });
  } else {
    await prisma.advanceBalance.create({ data: { flatId, societyId, amount } });
  }
  console.log(`Advance balance set to ${amount}`);

  // Generate bill for this flat only (mimic /api/billing/generate minimal path)
  const existing = await prisma.maintenanceBill.findUnique({ where: { flatId_month_year: { flatId, month, year } } });
  if (existing) {
    console.log('Bill already exists for', month + '/' + year, 'id=', existing.id);
  } else {
    // pick active config for flat type
    let cfg = await prisma.maintenanceConfig.findFirst({ where: { societyId, flatType: flat.type, isActive: true } });
    if (!cfg) {
      console.log('No active maintenance config found for flat type', flat.type, '- creating a default config');
      cfg = await prisma.maintenanceConfig.create({ data: {
        societyId,
        flatType: flat.type,
        baseAmount: 1000,
        waterCharge: 0,
        parkingCharge: 0,
        sinkingFund: 0,
        repairFund: 0,
        otherCharges: 0,
        lateFeePerDay: 10,
        dueDay: 10,
        isActive: true,
      }});
    }

    const totalAmount = (cfg.baseAmount || 0) + (cfg.waterCharge || 0) + (cfg.parkingCharge || 0) + (cfg.sinkingFund || 0) + (cfg.repairFund || 0) + (cfg.otherCharges || 0);
    const dueDay = Math.min(Math.max(cfg.dueDay || 1, 1), 28);
    const dueDate = new Date(year, month - 1, dueDay);

    const bill = await prisma.maintenanceBill.create({ data: {
      flatId, month, year,
      baseAmount: cfg.baseAmount, waterCharge: cfg.waterCharge, parkingCharge: cfg.parkingCharge,
      sinkingFund: cfg.sinkingFund, repairFund: cfg.repairFund, otherCharges: cfg.otherCharges,
      totalAmount, dueDate, status: 'PENDING'
    }});
    console.log('Created bill', bill.id, 'totalAmount=', bill.totalAmount);

    // Auto-apply advance if enabled
    const settings = await prisma.societySettings.findUnique({ where: { societyId } });
    if (settings?.autoAdjustAdvance) {
      const adv = await prisma.advanceBalance.findFirst({ where: { flatId } });
      if (adv && adv.amount > 0) {
        const toApply = Math.min(Number(adv.amount), Number(bill.totalAmount));
        if (toApply > 0) {
          const newPaid = (bill.paidAmount || 0) + toApply;
          const newStatus = newPaid >= bill.totalAmount ? 'PAID' : newPaid > 0 ? 'PARTIAL' : 'PENDING';

          const payment = await prisma.$transaction(async (tx) => {
            const createdPayment = await tx.payment.create({ data: {
              billId: bill.id, amount: toApply, method: 'CASH', status: 'SUCCESS', notes: 'Auto-applied advance balance', paidAt: new Date()
            }});

            await tx.maintenanceBill.update({ where: { id: bill.id }, data: { paidAmount: newPaid, status: newStatus } });

            if (adv.amount - toApply <= 0) {
              await tx.advanceBalance.delete({ where: { id: adv.id } });
            } else {
              await tx.advanceBalance.update({ where: { id: adv.id }, data: { amount: { set: adv.amount - toApply } } });
            }

            return createdPayment;
          });

          console.log('Applied advance to bill via payment', payment.id, 'amount', toApply);
        }
      } else {
        console.log('No advance found to apply');
      }
    } else {
      console.log('autoAdjustAdvance not enabled in society settings');
    }
  }

  const finalBill = await prisma.maintenanceBill.findUnique({ where: { flatId_month_year: { flatId, month, year } } });
  const finalAdvance = await prisma.advanceBalance.findFirst({ where: { flatId } });

  console.log('Final bill paidAmount=', finalBill?.paidAmount, 'status=', finalBill?.status);
  console.log('Remaining advance:', finalAdvance ? finalAdvance.amount : 0);

  await prisma.$disconnect();
}

run().catch((e)=>{console.error(e);process.exit(1)});
