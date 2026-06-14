import prisma from '../../config/database';
import logger from '../../config/logger';

/**
 * Compute and persist late fees for overdue maintenance bills.
 * This will set `maintenanceBill.lateFee` and adjust `totalAmount` accordingly.
 * If a bill is overdue and not fully paid, its status will be set to OVERDUE.
 * Returns number of bills updated.
 */
export async function computeAndApplyLateFees(societyId?: string) {
  const now = new Date();

  // Select bills that are past due and not fully paid
  const where: any = {
    dueDate: { lt: now },
    OR: [
      { status: { not: 'PAID' } },
    ],
  };
  if (societyId) {
    where.flat = { block: { societyId } };
  }

  const bills = await prisma.maintenanceBill.findMany({
    where,
    include: { flat: { include: { block: true } } },
  });

  let updatedCount = 0;

  for (const bill of bills) {
    try {
      // Find applicable config for this flat's society and flat type
      const config = await prisma.maintenanceConfig.findFirst({
        where: {
          societyId: bill.flat.block.societyId,
          isActive: true,
        },
        orderBy: { effectiveFrom: 'desc' },
      });

      const lateFeePerDay = config?.lateFeePerDay ?? 0;

      const daysOverdue = Math.max(0, Math.floor((Date.now() - bill.dueDate.getTime()) / 86400000));
      const newLateFee = Number((daysOverdue * lateFeePerDay).toFixed(2));

      // Recompute total amount from components + new late fee
      const baseComponentsSum = Number((bill.baseAmount + bill.waterCharge + bill.parkingCharge + bill.sinkingFund + bill.repairFund + bill.otherCharges).toFixed(2));
      const newTotal = Number((baseComponentsSum + newLateFee).toFixed(2));

      if (bill.lateFee !== newLateFee || bill.totalAmount !== newTotal) {
        const newStatus = (bill.paidAmount >= newTotal) ? 'PAID' : (newTotal > bill.paidAmount && bill.dueDate < now ? 'OVERDUE' : bill.status);

        await prisma.maintenanceBill.update({
          where: { id: bill.id },
          data: {
            lateFee: newLateFee,
            totalAmount: newTotal,
            status: newStatus as any,
          },
        });

        updatedCount++;
      }
    } catch (err: any) {
      logger.error('computeAndApplyLateFees: failed for bill', { billId: bill.id, error: err?.message });
    }
  }

  return updatedCount;
}

/**
 * Allocate an incoming payment amount to outstanding bills for a flat (oldest-first).
 * Returns allocation details.
 */
export async function allocatePayment(flatId: string, amount: number) {
  if (amount <= 0) return { remaining: 0, allocations: [] };

  return prisma.$transaction(async (tx) => {
    const bills = await tx.maintenanceBill.findMany({
      where: { flatId },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });

    const unpaidBills = bills.filter((b) => Number((b.totalAmount - b.paidAmount).toFixed(2)) > 0);

    let remaining = amount;
    const allocations: Array<{ billId: string; applied: number; newPaidAmount: number; newStatus: string }> = [];

    for (const bill of unpaidBills) {
      if (remaining <= 0) break;
      const due = Number(Math.max(0, bill.totalAmount - bill.paidAmount).toFixed(2));
      if (due <= 0) continue;
      const applied = Number(Math.min(remaining, due).toFixed(2));

      const newPaid = Number((bill.paidAmount + applied).toFixed(2));
      const newStatus = newPaid >= bill.totalAmount ? 'PAID' : 'PARTIAL';

      await tx.maintenanceBill.update({
        where: { id: bill.id },
        data: { paidAmount: newPaid, status: newStatus as any },
      });

      allocations.push({ billId: bill.id, applied, newPaidAmount: newPaid, newStatus });
      remaining = Number((remaining - applied).toFixed(2));
    }

    // If any remaining amount, credit to AdvanceBalance
    if (remaining > 0) {
      // Find or create AdvanceBalance for flat
      const existing = await tx.advanceBalance.findFirst({ where: { flatId } }).catch(() => null);
      if (existing) {
        await tx.advanceBalance.update({ where: { id: existing.id }, data: { amount: { increment: remaining } as any } as any });
      } else {
        // Need societyId — get from flat -> block -> societyId
        const flat = await tx.flat.findUnique({ where: { id: flatId }, include: { block: true } });
        const societyId = flat?.block?.societyId ?? '';
        await tx.advanceBalance.create({ data: { flatId, societyId, amount: remaining } as any });
      }
    }

    return { remaining, allocations };
  });
}

export default {
  computeAndApplyLateFees,
  allocatePayment,
};
