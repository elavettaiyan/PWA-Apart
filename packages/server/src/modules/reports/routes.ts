import { Router, Response } from 'express';
import { query } from 'express-validator';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest, FINANCIAL_ROLES } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';

const router = Router();
router.use(authenticate);

function getMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function addToBucket(bucket: Record<string, number>, key: string, amount: number) {
  bucket[key] = (bucket[key] || 0) + amount;
}

function getOutstandingAmount(totalAmount: number, paidAmount: number) {
  return Math.max(totalAmount - paidAmount, 0);
}

function getProratedCollectedAmount(componentAmount: number, totalAmount: number, paidAmount: number) {
  if (componentAmount <= 0 || totalAmount <= 0 || paidAmount <= 0) {
    return 0;
  }

  return (Math.min(paidAmount, totalAmount) * componentAmount) / totalAmount;
}

function getAgingBucket(dueDate: Date, asOfDate: Date) {
  const dayMs = 24 * 60 * 60 * 1000;
  const daysPastDue = Math.floor((asOfDate.getTime() - dueDate.getTime()) / dayMs);

  if (daysPastDue <= 0) return 'current';
  if (daysPastDue <= 30) return 'days1To30';
  if (daysPastDue <= 60) return 'days31To60';
  if (daysPastDue <= 90) return 'days61To90';
  return 'days90Plus';
}

// ── MY DASHBOARD (Owner/Tenant) ─────────────────────────
router.get('/my-dashboard', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    // Find user's flat
    const societyId = req.user!.societyId;
    const relationWhere = societyId ? { userId, flat: { block: { societyId } } } : { userId };

    const owner = await prisma.owner.findFirst({ where: relationWhere, select: { flatId: true } });
    const tenant = !owner ? await prisma.tenant.findFirst({ where: relationWhere, select: { flatId: true } }) : null;
    const flatId = owner?.flatId || tenant?.flatId;

    if (!flatId) return res.json({ pendingBills: 0, totalDue: 0, totalPaid: 0, openComplaints: 0 });

    const [pendingBills, totalDue, totalPaid, openComplaints] = await Promise.all([
      prisma.maintenanceBill.count({
        where: { flatId, status: { in: ['PENDING', 'OVERDUE'] } },
      }),
      prisma.maintenanceBill.aggregate({
        where: { flatId, status: { in: ['PENDING', 'OVERDUE', 'PARTIAL'] } },
        _sum: { totalAmount: true },
      }),
      prisma.payment.aggregate({
        where: { status: 'SUCCESS', bill: { flatId } },
        _sum: { amount: true },
      }),
      prisma.complaint.count({
        where: { createdById: userId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      }),
    ]);

    return res.json({
      pendingBills,
      totalDue: totalDue._sum.totalAmount || 0,
      totalPaid: totalPaid._sum.amount || 0,
      openComplaints,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

// ── DASHBOARD SUMMARY (Admin) ───────────────────────────
router.get('/dashboard', authorize('SUPER_ADMIN', ...FINANCIAL_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const societyId = req.user!.role === 'SUPER_ADMIN'
      ? (req.query.societyId as string) || req.user!.societyId
      : req.user!.societyId;
    if (!societyId) return res.status(400).json({ error: 'Society ID required' });

    const [
      totalFlats,
      occupiedFlats,
      totalOwners,
      totalTenants,
      openComplaints,
      pendingBills,
      totalCollected,
      totalExpenses,
    ] = await Promise.all([
      prisma.flat.count({ where: { block: { societyId } } }),
      prisma.flat.count({ where: { block: { societyId }, isOccupied: true } }),
      prisma.owner.count({ where: { flat: { block: { societyId } } } }),
      prisma.tenant.count({ where: { flat: { block: { societyId } }, isActive: true } }),
      prisma.complaint.count({ where: { societyId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      prisma.maintenanceBill.count({
        where: { flat: { block: { societyId } }, status: { in: ['PENDING', 'OVERDUE'] } },
      }),
      prisma.payment.aggregate({
        where: { status: 'SUCCESS', bill: { flat: { block: { societyId } } } },
        _sum: { amount: true },
      }),
      prisma.expense.aggregate({
        where: { societyId },
        _sum: { amount: true },
      }),
    ]);

    return res.json({
      totalFlats,
      occupiedFlats,
      vacantFlats: totalFlats - occupiedFlats,
      totalOwners,
      totalTenants,
      openComplaints,
      pendingBills,
      totalCollected: totalCollected._sum.amount || 0,
      totalExpenses: totalExpenses._sum.amount || 0,
      netBalance: (totalCollected._sum.amount || 0) - (totalExpenses._sum.amount || 0),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// ── MONTHLY COLLECTION REPORT ───────────────────────────
router.get(
  '/collection',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  [query('month').isInt({ min: 1, max: 12 }), query('year').isInt({ min: 2020 })],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const month = parseInt(req.query.month as string);
      const year = parseInt(req.query.year as string);
      const societyId = req.user!.role === 'SUPER_ADMIN'
        ? (req.query.societyId as string) || req.user!.societyId
        : req.user!.societyId;

      const bills = await prisma.maintenanceBill.findMany({
        where: {
          month,
          year,
          flat: { block: { societyId: societyId! } },
        },
        include: {
          flat: {
            include: {
              block: { select: { name: true } },
              owner: { select: { name: true, phone: true } },
            },
          },
          payments: { where: { status: 'SUCCESS' } },
        },
        orderBy: { flat: { flatNumber: 'asc' } },
      });

      const totalBilled = bills.reduce((sum, b) => sum + b.totalAmount, 0);
      const totalCollected = bills.reduce((sum, b) => sum + b.paidAmount, 0);
      const totalPending = totalBilled - totalCollected;

      const paidCount = bills.filter((b) => b.status === 'PAID').length;
      const pendingCount = bills.filter((b) => b.status === 'PENDING' || b.status === 'OVERDUE').length;
      const partialCount = bills.filter((b) => b.status === 'PARTIAL').length;

      return res.json({
        month,
        year,
        bills,
        summary: {
          totalBilled,
          totalCollected,
          totalPending,
          collectionRate: totalBilled > 0 ? ((totalCollected / totalBilled) * 100).toFixed(1) : '0',
          paidCount,
          pendingCount,
          partialCount,
          totalBills: bills.length,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch collection report' });
    }
  },
);

// ── DEFAULTERS REPORT ───────────────────────────────────
router.get('/defaulters', authorize('SUPER_ADMIN', ...FINANCIAL_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const societyId = req.user!.role === 'SUPER_ADMIN'
      ? (req.query.societyId as string) || req.user!.societyId
      : req.user!.societyId;

    const defaulters = await prisma.maintenanceBill.findMany({
      where: {
        flat: { block: { societyId: societyId! } },
        status: { in: ['PENDING', 'OVERDUE', 'PARTIAL'] },
      },
      include: {
        flat: {
          include: {
            block: { select: { name: true } },
            owner: { select: { name: true, phone: true, email: true } },
          },
        },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    // Group by flat
    const grouped = defaulters.reduce((acc: Record<string, any>, bill) => {
      const key = bill.flatId;
      if (!acc[key]) {
        acc[key] = {
          flat: bill.flat,
          bills: [],
          totalOutstanding: 0,
        };
      }
      acc[key].bills.push(bill);
      acc[key].totalOutstanding += bill.totalAmount - bill.paidAmount;
      return acc;
    }, {});

    const result = Object.values(grouped).sort(
      (a: any, b: any) => b.totalOutstanding - a.totalOutstanding,
    );

    return res.json({
      defaulters: result,
      totalDefaulters: result.length,
      totalOutstanding: result.reduce((sum: number, d: any) => sum + d.totalOutstanding, 0),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch defaulters report' });
  }
});

// ── EXPENSE SUMMARY REPORT ──────────────────────────────
router.get(
  '/expense-summary',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  [query('fromDate').optional().isISO8601(), query('toDate').optional().isISO8601()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.role === 'SUPER_ADMIN'
        ? (req.query.societyId as string) || req.user!.societyId
        : req.user!.societyId;
      const where: any = { societyId };

      if (req.query.fromDate || req.query.toDate) {
        where.expenseDate = {};
        if (req.query.fromDate) where.expenseDate.gte = new Date(req.query.fromDate as string);
        if (req.query.toDate) where.expenseDate.lte = new Date(req.query.toDate as string);
      }

      const byCategory = await prisma.expense.groupBy({
        by: ['category'],
        where,
        _sum: { amount: true },
        _count: true,
        orderBy: { _sum: { amount: 'desc' } },
      });

      const total = byCategory.reduce((sum, c) => sum + (c._sum.amount || 0), 0);

      // Monthly trend (last 12 months)
      const expenses = await prisma.expense.findMany({
        where,
        select: { amount: true, expenseDate: true, category: true },
        orderBy: { expenseDate: 'asc' },
      });

      const monthlyTrend: Record<string, number> = {};
      expenses.forEach((e) => {
        const key = `${e.expenseDate.getFullYear()}-${String(e.expenseDate.getMonth() + 1).padStart(2, '0')}`;
        monthlyTrend[key] = (monthlyTrend[key] || 0) + e.amount;
      });

      return res.json({ byCategory, total, monthlyTrend });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch expense summary' });
    }
  },
);

// ── P&L REPORT ──────────────────────────────────────────
router.get(
  '/pnl',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  [query('fromDate').isISO8601(), query('toDate').isISO8601()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.role === 'SUPER_ADMIN'
        ? (req.query.societyId as string) || req.user!.societyId
        : req.user!.societyId;
      const fromDate = new Date(req.query.fromDate as string);
      const toDate = new Date(req.query.toDate as string);
      const periodEnd = new Date(toDate);
      periodEnd.setHours(23, 59, 59, 999);

      const billedBills = await prisma.maintenanceBill.findMany({
        where: {
          dueDate: { gte: fromDate, lte: periodEnd },
          flat: { block: { societyId: societyId! } },
        },
        select: {
          totalAmount: true,
          paidAmount: true,
          dueDate: true,
          baseAmount: true,
          waterCharge: true,
          parkingCharge: true,
          sinkingFund: true,
          repairFund: true,
          otherCharges: true,
          lateFee: true,
        },
      });

      // COLLECTED INCOME: Successful payments in the period
      const income = await prisma.payment.aggregate({
        where: {
          status: 'SUCCESS',
          paidAt: { gte: fromDate, lte: periodEnd },
          bill: { flat: { block: { societyId: societyId! } } },
        },
        _sum: { amount: true },
      });

      // Income breakdown by month
      const payments = await prisma.payment.findMany({
        where: {
          status: 'SUCCESS',
          paidAt: { gte: fromDate, lte: periodEnd },
          bill: { flat: { block: { societyId: societyId! } } },
        },
        select: { amount: true, paidAt: true },
      });

      const incomeByMonth: Record<string, number> = {};
      payments.forEach((p) => {
        if (p.paidAt) {
          const key = getMonthKey(p.paidAt);
          incomeByMonth[key] = (incomeByMonth[key] || 0) + p.amount;
        }
      });

      const billedIncomeByMonth: Record<string, number> = {};
      const billedIncomeByComponent = {
        baseAmount: 0,
        waterCharge: 0,
        parkingCharge: 0,
        sinkingFund: 0,
        repairFund: 0,
        otherCharges: 0,
        lateFee: 0,
      };
      const reserveFunds = {
        sinkingFundBilled: 0,
        repairFundBilled: 0,
        sinkingFundCollected: 0,
        repairFundCollected: 0,
        sinkingFundOutstanding: 0,
        repairFundOutstanding: 0,
      };

      billedBills.forEach((bill) => {
        addToBucket(billedIncomeByMonth, getMonthKey(bill.dueDate), bill.totalAmount);
        billedIncomeByComponent.baseAmount += bill.baseAmount;
        billedIncomeByComponent.waterCharge += bill.waterCharge;
        billedIncomeByComponent.parkingCharge += bill.parkingCharge;
        billedIncomeByComponent.sinkingFund += bill.sinkingFund;
        billedIncomeByComponent.repairFund += bill.repairFund;
        billedIncomeByComponent.otherCharges += bill.otherCharges;
        billedIncomeByComponent.lateFee += bill.lateFee;

        const sinkingFundCollected = getProratedCollectedAmount(bill.sinkingFund, bill.totalAmount, bill.paidAmount);
        const repairFundCollected = getProratedCollectedAmount(bill.repairFund, bill.totalAmount, bill.paidAmount);

        reserveFunds.sinkingFundBilled += bill.sinkingFund;
        reserveFunds.repairFundBilled += bill.repairFund;
        reserveFunds.sinkingFundCollected += sinkingFundCollected;
        reserveFunds.repairFundCollected += repairFundCollected;
        reserveFunds.sinkingFundOutstanding += Math.max(bill.sinkingFund - sinkingFundCollected, 0);
        reserveFunds.repairFundOutstanding += Math.max(bill.repairFund - repairFundCollected, 0);
      });

      const receivableBills = await prisma.maintenanceBill.findMany({
        where: {
          status: { in: ['PENDING', 'OVERDUE', 'PARTIAL'] },
          flat: { block: { societyId: societyId! } },
          dueDate: { lte: periodEnd },
        },
        select: {
          totalAmount: true,
          paidAmount: true,
          dueDate: true,
        },
      });

      const agingBuckets = {
        current: 0,
        days1To30: 0,
        days31To60: 0,
        days61To90: 0,
        days90Plus: 0,
      };

      receivableBills.forEach((bill) => {
        const outstandingAmount = getOutstandingAmount(bill.totalAmount, bill.paidAmount);
        if (outstandingAmount <= 0) {
          return;
        }

        const agingBucket = getAgingBucket(bill.dueDate, periodEnd);
        agingBuckets[agingBucket] += outstandingAmount;
      });

      // EXPENSES: Expenses in the period
      const expensesByCategory = await prisma.expense.groupBy({
        by: ['category'],
        where: {
          societyId: societyId!,
          expenseDate: { gte: fromDate, lte: toDate },
        },
        _sum: { amount: true },
      });

      const totalExpenses = expensesByCategory.reduce(
        (sum, e) => sum + (e._sum.amount || 0),
        0,
      );

      // Expense breakdown by month
      const expensesList = await prisma.expense.findMany({
        where: {
          societyId: societyId!,
          expenseDate: { gte: fromDate, lte: toDate },
        },
        select: { amount: true, expenseDate: true, category: true },
      });

      const expenseByMonth: Record<string, number> = {};
      expensesList.forEach((e) => {
        const key = getMonthKey(e.expenseDate);
        expenseByMonth[key] = (expenseByMonth[key] || 0) + e.amount;
      });

      const totalCollectedIncome = income._sum.amount || 0;
      const totalBilledIncome = billedBills.reduce((sum, bill) => sum + bill.totalAmount, 0);
      const netProfitLoss = totalBilledIncome - totalExpenses;
      const cashSurplus = totalCollectedIncome - totalExpenses;
      const totalOutstandingReceivables = receivableBills.reduce(
        (sum, bill) => sum + getOutstandingAmount(bill.totalAmount, bill.paidAmount),
        0,
      );

      return res.json({
        period: { from: fromDate, to: toDate },
        billedIncome: {
          total: totalBilledIncome,
          byMonth: billedIncomeByMonth,
          byComponent: billedIncomeByComponent,
        },
        collectedIncome: {
          total: totalCollectedIncome,
          byMonth: incomeByMonth,
        },
        expenses: {
          total: totalExpenses,
          byCategory: expensesByCategory,
          byMonth: expenseByMonth,
        },
        receivables: {
          totalOutstanding: totalOutstandingReceivables,
          agingBuckets,
        },
        reserveFunds,
        netProfitLoss,
        cashSurplus,
        profitMargin: totalBilledIncome > 0
          ? ((netProfitLoss / totalBilledIncome) * 100).toFixed(1)
          : '0',
      });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to generate P&L report' });
    }
  },
);

export default router;
