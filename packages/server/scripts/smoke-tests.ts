import prisma from '../src/config/database';
import { allocatePayment } from '../src/modules/collections/service';

async function singlePaymentFlow() {
  console.log('--- singlePaymentFlow ---');
  const bill = await prisma.maintenanceBill.findFirst({
    where: { status: { in: ['PENDING','PARTIAL','OVERDUE'] }, totalAmount: { gt: 0 } },
    include: { flat: true },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });
  if (!bill) {
    console.log('No unpaid bills found for singlePaymentFlow');
    return;
  }

  const due = Number((bill.totalAmount - bill.paidAmount).toFixed(2));
  const payAmount = Number((Math.min(due, Math.round(due / 2 * 100) / 100)).toFixed(2));

  const payment = await prisma.payment.create({
    data: {
      billId: bill.id,
      amount: payAmount,
      method: 'PHONEPE',
      status: 'INITIATED',
      merchantTransId: `SMOKE-SINGLE-${Date.now()}`,
    },
  });

  // Simulate success
  await prisma.payment.update({ where: { id: payment.id }, data: { status: 'SUCCESS', paidAt: new Date() } });

  const alloc = await allocatePayment(bill.flatId, payment.amount);
  console.log('Allocation result:', alloc);

  const adv = await prisma.advanceBalance.findFirst({ where: { flatId: bill.flatId } });
  console.log('AdvanceBalance:', adv);
}

async function bulkPaymentFlow() {
  console.log('--- bulkPaymentFlow ---');
  // Find a flat with at least 2 unpaid bills
  const bills = await prisma.maintenanceBill.findMany({
    where: { status: { in: ['PENDING','PARTIAL','OVERDUE'] }, totalAmount: { gt: 0 } },
    include: { flat: true },
    orderBy: [{ flatId: 'asc' }, { year: 'asc' }, { month: 'asc' }],
  });

  // Group by flatId
  const byFlat: Record<string, typeof bills> = {} as any;
  for (const b of bills) {
    if (!byFlat[b.flatId]) byFlat[b.flatId] = [] as any;
    byFlat[b.flatId].push(b);
  }

  const flatId = Object.keys(byFlat).find((k) => byFlat[k].length >= 2);
  if (!flatId) {
    console.log('No flat with 2+ unpaid bills found for bulk test');
    return;
  }

  const targetBills = byFlat[flatId].slice(0, 3);
  const payments = [] as any[];
  for (const b of targetBills) {
    const due = Number((b.totalAmount - b.paidAmount).toFixed(2));
    const p = await prisma.payment.create({ data: { billId: b.id, amount: Math.round(due * 100) / 100, method: 'PHONEPE', status: 'INITIATED', merchantTransId: `SMOKE-BULK-${Date.now()}-${b.id.slice(0,6)}` } });
    payments.push({ p, bill: b });
  }

  // Mark all success
  for (const item of payments) {
    await prisma.payment.update({ where: { id: item.p.id }, data: { status: 'SUCCESS', paidAt: new Date() } });
  }

  // Run allocation per payment
  for (const item of payments) {
    const r = await allocatePayment(item.bill.flatId, item.p.amount);
    console.log('Bulk allocation for payment', item.p.id, r);
  }

  const adv = await prisma.advanceBalance.findFirst({ where: { flatId } });
  console.log('AdvanceBalance after bulk:', adv);
}

async function main() {
  try {
    // single payment
    await singlePaymentFlow();
    // bulk payment
    await bulkPaymentFlow();
    console.log('Smoke tests finished');
  } catch (err: any) {
    console.error('Smoke tests failed', err?.message || err);
  } finally {
    process.exit(0);
  }
}

main();
