import { Router, Response } from 'express';
import { query } from 'express-validator';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';

const router = Router();
router.use(authenticate);

// ── MY DASHBOARD (Owner/Tenant) ─────────────────────────
router.get('/my-dashboard', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    // Find user's flat
    const owner = await prisma.owner.findUnique({ where: { userId }, select: { flatId: true } });
    const tenant = !owner ? await prisma.tenant.findUnique({ where: { userId }, select: { flatId: true } }) : null;
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
router.get('/dashboard', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const societyId = (req.query.societyId as string) || req.user!.societyId;
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
  authorize('SUPER_ADMIN', 'ADMIN'),
  [query('month').isInt({ min: 1, max: 12 }), query('year').isInt({ min: 2020 })],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const month = parseInt(req.query.month as string);
      const year = parseInt(req.query.year as string);
      const societyId = (req.query.societyId as string) || req.user!.societyId;

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
router.get('/defaulters', authorize('SUPER_ADMIN', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const societyId = (req.query.societyId as string) || req.user!.societyId;

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
  authorize('SUPER_ADMIN', 'ADMIN'),
  [query('fromDate').optional().isISO8601(), query('toDate').optional().isISO8601()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = (req.query.societyId as string) || req.user!.societyId;
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
  authorize('SUPER_ADMIN', 'ADMIN'),
  [query('fromDate').isISO8601(), query('toDate').isISO8601()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = (req.query.societyId as string) || req.user!.societyId;
      const fromDate = new Date(req.query.fromDate as string);
      const toDate = new Date(req.query.toDate as string);

      // INCOME: Successful payments in the period
      const income = await prisma.payment.aggregate({
        where: {
          status: 'SUCCESS',
          paidAt: { gte: fromDate, lte: toDate },
          bill: { flat: { block: { societyId: societyId! } } },
        },
        _sum: { amount: true },
      });

      // Income breakdown by month
      const payments = await prisma.payment.findMany({
        where: {
          status: 'SUCCESS',
          paidAt: { gte: fromDate, lte: toDate },
          bill: { flat: { block: { societyId: societyId! } } },
        },
        select: { amount: true, paidAt: true },
      });

      const incomeByMonth: Record<string, number> = {};
      payments.forEach((p) => {
        if (p.paidAt) {
          const key = `${p.paidAt.getFullYear()}-${String(p.paidAt.getMonth() + 1).padStart(2, '0')}`;
          incomeByMonth[key] = (incomeByMonth[key] || 0) + p.amount;
        }
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
        const key = `${e.expenseDate.getFullYear()}-${String(e.expenseDate.getMonth() + 1).padStart(2, '0')}`;
        expenseByMonth[key] = (expenseByMonth[key] || 0) + e.amount;
      });

      const totalIncome = income._sum.amount || 0;
      const netProfitLoss = totalIncome - totalExpenses;

      return res.json({
        period: { from: fromDate, to: toDate },
        income: {
          total: totalIncome,
          byMonth: incomeByMonth,
        },
        expenses: {
          total: totalExpenses,
          byCategory: expensesByCategory,
          byMonth: expenseByMonth,
        },
        netProfitLoss,
        profitMargin: totalIncome > 0
          ? ((netProfitLoss / totalIncome) * 100).toFixed(1)
          : '0',
      });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to generate P&L report' });
    }
  },
);

export default router;
