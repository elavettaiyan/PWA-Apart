import { Router, Response } from 'express';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest, FINANCIAL_ROLES } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { getResidentFlatIds } from '../entries/utils';
import { resolveReportSocietyId } from './permissions';
import {
  addToBucket,
  applyBillBreakdown,
  buildAccountingPeriodWhere,
  createBilledIncomeBreakdown,
  createBillKindBreakdown,
  createSpecialChargeBreakdown,
  formatExcelDate,
  getAccountingMonthKey,
  getAgingBucket,
  getMonthKey,
  getOutstandingAmount,
  getProratedCollectedAmount,
  getResidentReportRows,
  sendWorkbook,
} from './service';
import {
  collectionReportValidation,
  optionalDateRangeValidation,
  residentExportValidation,
  residentReportValidation,
  requiredDateRangeValidation,
} from './validation';

const router = Router();
router.use(authenticate);

// ── MY DASHBOARD (Owner/Tenant) ─────────────────────────
router.get('/my-dashboard', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    // Find user's linked flats in the active society
    const societyId = req.user!.societyId;
    const flatIds = societyId ? await getResidentFlatIds(userId, societyId) : [];
    const recentSince = new Date();
    recentSince.setDate(recentSince.getDate() - 7);

    const communityWhere = societyId ? { societyId } : undefined;
    const [unreadAnnouncements, upcomingEvents] = societyId
      ? await Promise.all([
          prisma.announcementBroadcast.count({
            where: { societyId, readStates: { none: { userId } } },
          }),
          prisma.societyEvent.count({
            where: { societyId, status: 'SCHEDULED', startAt: { gte: new Date() } },
          }),
        ])
      : [0, 0];

    if (flatIds.length === 0) return res.json({
      pendingBills: 0,
      totalDue: 0,
      totalPaid: 0,
      openComplaints: 0,
      unreadAnnouncements,
      upcomingEvents,
      recentVisitors: 0,
      recentDeliveries: 0,
    });

    const flatScope = { in: flatIds };
    const [pendingBills, totalDue, totalPaid, openComplaints, recentVisitors, recentDeliveries] = await Promise.all([
      prisma.maintenanceBill.count({
        where: { flatId: flatScope, status: { in: ['PENDING', 'OVERDUE'] } },
      }),
      prisma.maintenanceBill.aggregate({
        where: { flatId: flatScope, status: { in: ['PENDING', 'OVERDUE', 'PARTIAL'] } },
        _sum: { totalAmount: true },
      }),
      prisma.payment.aggregate({
        where: { status: 'SUCCESS', bill: { flatId: flatScope } },
        _sum: { amount: true },
      }),
      prisma.complaint.count({
        where: { createdById: userId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      }),
      prisma.visitor.count({
        where: { flatId: flatScope, checkedInAt: { gte: recentSince }, ...(communityWhere || {}) },
      }),
      prisma.delivery.count({
        where: { flatId: flatScope, deliveredAt: { gte: recentSince }, ...(communityWhere || {}) },
      }),
    ]);

    return res.json({
      pendingBills,
      totalDue: totalDue._sum.totalAmount || 0,
      totalPaid: totalPaid._sum.amount || 0,
      openComplaints,
      unreadAnnouncements,
      upcomingEvents,
      recentVisitors,
      recentDeliveries,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

// ── DASHBOARD SUMMARY (Admin) ───────────────────────────
router.get('/dashboard', authorize('SUPER_ADMIN', ...FINANCIAL_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const societyId = resolveReportSocietyId(req);
    if (!societyId) return res.status(400).json({ error: 'Society ID required' });
    const recentSince = new Date();
    recentSince.setDate(recentSince.getDate() - 7);

    const [
      totalFlats,
      occupiedFlats,
      totalOwners,
      totalTenants,
      openComplaints,
      pendingBills,
      totalCollected,
      totalExpenses,
      unreadAnnouncements,
      upcomingEvents,
      recentVisitors,
      recentDeliveries,
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
      prisma.announcementBroadcast.count({
        where: { societyId, readStates: { none: { userId: req.user!.id } } },
      }),
      prisma.societyEvent.count({
        where: { societyId, status: 'SCHEDULED', startAt: { gte: new Date() } },
      }),
      prisma.visitor.count({
        where: { societyId, checkedInAt: { gte: recentSince } },
      }),
      prisma.delivery.count({
        where: { societyId, deliveredAt: { gte: recentSince } },
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
      unreadAnnouncements,
      upcomingEvents,
      recentVisitors,
      recentDeliveries,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// ── RESIDENT REPORT ─────────────────────────────────────
router.get(
  '/residents',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  residentReportValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = resolveReportSocietyId(req);

      if (!societyId) {
        return res.status(400).json({ error: 'Society ID required' });
      }

      const filters = {
        name: req.query.name as string | undefined,
        mobile: req.query.mobile as string | undefined,
        carNumber: req.query.carNumber as string | undefined,
      };

      const page = Math.max(parseInt((req.query.page as string) || '1', 10), 1);
      const pageSize = Math.max(parseInt((req.query.pageSize as string) || '20', 10), 1);
      const allResidents = await getResidentReportRows(societyId, filters);
      const totalItems = allResidents.length;
      const totalPages = Math.max(Math.ceil(totalItems / pageSize), 1);
      const currentPage = Math.min(page, totalPages);
      const start = (currentPage - 1) * pageSize;
      const residents = allResidents.slice(start, start + pageSize);
      const summary = {
        totalResidents: totalItems,
        owners: allResidents.filter((resident) => resident.relation === 'OWNER').length,
        tenants: allResidents.filter((resident) => resident.relation === 'TENANT').length,
      };

      return res.json({
        residents,
        summary,
        filters,
        pagination: {
          page: currentPage,
          pageSize,
          totalItems,
          totalPages,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch resident report' });
    }
  },
);

router.get(
  '/residents/export',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  residentExportValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = resolveReportSocietyId(req);

      if (!societyId) {
        return res.status(400).json({ error: 'Society ID required' });
      }

      const filters = {
        name: req.query.name as string | undefined,
        mobile: req.query.mobile as string | undefined,
        carNumber: req.query.carNumber as string | undefined,
      };

      const residents = await getResidentReportRows(societyId, filters);

      return sendWorkbook(res, 'resident-report.xlsx', [
        {
          name: 'Residents',
          rows: residents.map((resident) => ({
            Relation: resident.relation,
            Name: resident.name,
            Mobile: resident.mobile,
            Email: resident.email,
            CarNumber: resident.carNumber,
            TwoWheelerNumber: resident.twoWheelerNumber,
            Flat: resident.flatNumber,
            Block: resident.blockName,
          })),
        },
      ]);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to export resident report' });
    }
  },
);

// ── MONTHLY COLLECTION REPORT ───────────────────────────
router.get(
  '/collection',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  collectionReportValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const month = parseInt(req.query.month as string);
      const year = parseInt(req.query.year as string);
      const societyId = resolveReportSocietyId(req);

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

router.get(
  '/collection/export',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  collectionReportValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const month = parseInt(req.query.month as string);
      const year = parseInt(req.query.year as string);
      const societyId = resolveReportSocietyId(req);

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

      const totalBilled = bills.reduce((sum, bill) => sum + bill.totalAmount, 0);
      const totalCollected = bills.reduce((sum, bill) => sum + bill.paidAmount, 0);
      const totalPending = totalBilled - totalCollected;

      return sendWorkbook(res, `collection-report-${year}-${String(month).padStart(2, '0')}.xlsx`, [
        {
          name: 'Summary',
          rows: [{
            Month: month,
            Year: year,
            TotalBills: bills.length,
            TotalBilled: totalBilled,
            TotalCollected: totalCollected,
            TotalPending: totalPending,
            PaidCount: bills.filter((bill) => bill.status === 'PAID').length,
            PendingCount: bills.filter((bill) => bill.status === 'PENDING' || bill.status === 'OVERDUE').length,
            PartialCount: bills.filter((bill) => bill.status === 'PARTIAL').length,
            CollectionRate: totalBilled > 0 ? Number(((totalCollected / totalBilled) * 100).toFixed(1)) : 0,
          }],
        },
        {
          name: 'Bills',
          rows: bills.map((bill) => ({
            Flat: bill.flat.flatNumber,
            Block: bill.flat.block.name,
            Owner: bill.flat.owner?.name || '',
            Phone: bill.flat.owner?.phone || '',
            Month: `${bill.month}/${bill.year}`,
            TotalAmount: bill.totalAmount,
            PaidAmount: bill.paidAmount,
            OutstandingAmount: Math.max(bill.totalAmount - bill.paidAmount, 0),
            DueDate: formatExcelDate(bill.dueDate),
            Status: bill.status,
            PaymentCount: bill.payments.length,
          })),
        },
      ]);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to export collection report' });
    }
  },
);

// ── DEFAULTERS REPORT ───────────────────────────────────
router.get('/defaulters', authorize('SUPER_ADMIN', ...FINANCIAL_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const societyId = resolveReportSocietyId(req);

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

router.get('/defaulters/export', authorize('SUPER_ADMIN', ...FINANCIAL_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const societyId = resolveReportSocietyId(req);

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

    const result = Object.values(grouped).sort((a: any, b: any) => b.totalOutstanding - a.totalOutstanding);

    return sendWorkbook(res, 'defaulters-report.xlsx', [
      {
        name: 'Summary',
        rows: [{
          TotalDefaulters: result.length,
          TotalOutstanding: result.reduce((sum: number, item: any) => sum + item.totalOutstanding, 0),
        }],
      },
      {
        name: 'Defaulters',
        rows: result.map((item: any) => ({
          Flat: item.flat.flatNumber,
          Block: item.flat.block?.name || '',
          Owner: item.flat.owner?.name || '',
          Phone: item.flat.owner?.phone || '',
          Email: item.flat.owner?.email || '',
          PendingBills: item.bills.length,
          TotalOutstanding: item.totalOutstanding,
          BillMonths: item.bills.map((bill: any) => `${bill.month}/${bill.year}`).join(', '),
        })),
      },
      {
        name: 'Bill Details',
        rows: defaulters.map((bill) => ({
          Flat: bill.flat.flatNumber,
          Block: bill.flat.block?.name || '',
          Owner: bill.flat.owner?.name || '',
          Month: `${bill.month}/${bill.year}`,
          DueDate: formatExcelDate(bill.dueDate),
          TotalAmount: bill.totalAmount,
          PaidAmount: bill.paidAmount,
          OutstandingAmount: Math.max(bill.totalAmount - bill.paidAmount, 0),
          Status: bill.status,
        })),
      },
    ]);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to export defaulters report' });
  }
});

// ── EXPENSE SUMMARY REPORT ──────────────────────────────
router.get(
  '/expense-summary',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  optionalDateRangeValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = resolveReportSocietyId(req);
      const where: any = { societyId };
      const fromDate = req.query.fromDate ? new Date(req.query.fromDate as string) : undefined;
      const toDate = req.query.toDate ? new Date(req.query.toDate as string) : undefined;

      const accountingPeriodFilter = buildAccountingPeriodWhere(fromDate, toDate);
      if (accountingPeriodFilter) {
        Object.assign(where, accountingPeriodFilter);
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
        select: { amount: true, accountingMonth: true, accountingYear: true, category: true },
        orderBy: [{ accountingYear: 'asc' }, { accountingMonth: 'asc' }, { expenseDate: 'asc' }],
      });

      const monthlyTrend: Record<string, number> = {};
      expenses.forEach((e) => {
        const key = getAccountingMonthKey(e.accountingYear, e.accountingMonth);
        monthlyTrend[key] = (monthlyTrend[key] || 0) + e.amount;
      });

      return res.json({ byCategory, total, monthlyTrend });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch expense summary' });
    }
  },
);

router.get(
  '/expense-summary/export',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  optionalDateRangeValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = resolveReportSocietyId(req);
      const where: any = { societyId };
      const fromDate = req.query.fromDate ? new Date(req.query.fromDate as string) : undefined;
      const toDate = req.query.toDate ? new Date(req.query.toDate as string) : undefined;

      const accountingPeriodFilter = buildAccountingPeriodWhere(fromDate, toDate);
      if (accountingPeriodFilter) {
        Object.assign(where, accountingPeriodFilter);
      }

      const byCategory = await prisma.expense.groupBy({
        by: ['category'],
        where,
        _sum: { amount: true },
        _count: true,
        orderBy: { _sum: { amount: 'desc' } },
      });

      const expenses = await prisma.expense.findMany({
        where,
        select: {
          description: true,
          category: true,
          amount: true,
          vendor: true,
          expenseDate: true,
          accountingMonth: true,
          accountingYear: true,
        },
        orderBy: [{ accountingYear: 'asc' }, { accountingMonth: 'asc' }, { expenseDate: 'asc' }],
      });

      const monthlyTrend: Record<string, number> = {};
      expenses.forEach((expense) => {
        const key = getAccountingMonthKey(expense.accountingYear, expense.accountingMonth);
        monthlyTrend[key] = (monthlyTrend[key] || 0) + expense.amount;
      });

      return sendWorkbook(res, 'expense-summary-report.xlsx', [
        {
          name: 'Summary',
          rows: [{
            FromDate: formatExcelDate(fromDate),
            ToDate: formatExcelDate(toDate),
            TotalExpense: byCategory.reduce((sum, item) => sum + (item._sum.amount || 0), 0),
          }],
        },
        {
          name: 'By Category',
          rows: byCategory.map((item) => ({
            Category: item.category,
            TransactionCount: item._count,
            TotalAmount: item._sum.amount || 0,
          })),
        },
        {
          name: 'Monthly Trend',
          rows: Object.entries(monthlyTrend).map(([monthKey, amount]) => ({
            Month: monthKey,
            TotalAmount: amount,
          })),
        },
        {
          name: 'Expense Details',
          rows: expenses.map((expense) => ({
            Description: expense.description,
            Category: expense.category,
            Amount: expense.amount,
            Vendor: expense.vendor || '',
            ExpenseDate: formatExcelDate(expense.expenseDate),
            AccountingMonth: `${expense.accountingMonth}/${expense.accountingYear}`,
          })),
        },
      ]);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to export expense summary report' });
    }
  },
);

// ── P&L REPORT ──────────────────────────────────────────
router.get(
  '/pnl',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  requiredDateRangeValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = resolveReportSocietyId(req);
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
          billKind: true,
          title: true,
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
          lineItems: {
            select: {
              category: true,
              label: true,
              amount: true,
            },
          },
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
      const billedIncomeByComponent = createBilledIncomeBreakdown();
      const billedIncomeByKind = createBillKindBreakdown();
      const specialChargeBreakdown = createSpecialChargeBreakdown();
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
        applyBillBreakdown(bill, billedIncomeByComponent, billedIncomeByKind, specialChargeBreakdown);

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
          ...buildAccountingPeriodWhere(fromDate, toDate),
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
          ...buildAccountingPeriodWhere(fromDate, toDate),
        },
        select: { amount: true, accountingMonth: true, accountingYear: true, category: true },
      });

      const expenseByMonth: Record<string, number> = {};
      expensesList.forEach((e) => {
        const key = getAccountingMonthKey(e.accountingYear, e.accountingMonth);
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
          byKind: billedIncomeByKind,
          bySpecialCategory: specialChargeBreakdown,
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

router.get(
  '/pnl/export',
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  requiredDateRangeValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = resolveReportSocietyId(req);
      const fromDate = new Date(req.query.fromDate as string);
      const toDate = new Date(req.query.toDate as string);
      const periodEnd = new Date(toDate);
      periodEnd.setHours(23, 59, 59, 999);

      const billedBills = await prisma.maintenanceBill.findMany({
        where: {
          dueDate: { gte: fromDate, lte: periodEnd },
          flat: { block: { societyId: societyId! } },
        },
        include: {
          lineItems: {
            select: {
              category: true,
              label: true,
              amount: true,
            },
          },
          flat: {
            include: {
              block: { select: { name: true } },
            },
          },
        },
      });

      const payments = await prisma.payment.findMany({
        where: {
          status: 'SUCCESS',
          paidAt: { gte: fromDate, lte: periodEnd },
          bill: { flat: { block: { societyId: societyId! } } },
        },
        include: {
          bill: {
            include: {
              flat: {
                include: {
                  block: { select: { name: true } },
                },
              },
            },
          },
        },
      });

      const expenses = await prisma.expense.findMany({
        where: {
          societyId: societyId!,
          ...buildAccountingPeriodWhere(fromDate, toDate),
        },
        orderBy: [{ accountingYear: 'asc' }, { accountingMonth: 'asc' }, { expenseDate: 'asc' }],
      });

      const totalBilledIncome = billedBills.reduce((sum, bill) => sum + bill.totalAmount, 0);
      const totalCollectedIncome = payments.reduce((sum, payment) => sum + payment.amount, 0);
      const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
      const netProfitLoss = totalBilledIncome - totalExpenses;
      const cashSurplus = totalCollectedIncome - totalExpenses;
      const billedIncomeByComponent = createBilledIncomeBreakdown();
      const billedIncomeByKind = createBillKindBreakdown();
      const specialChargeBreakdown = createSpecialChargeBreakdown();

      billedBills.forEach((bill) => {
        applyBillBreakdown(bill, billedIncomeByComponent, billedIncomeByKind, specialChargeBreakdown);
      });

      const receivableBills = billedBills.filter((bill) => ['PENDING', 'OVERDUE', 'PARTIAL'].includes(bill.status));
      const agingBuckets = {
        Current: 0,
        '1-30 Days': 0,
        '31-60 Days': 0,
        '61-90 Days': 0,
        '90+ Days': 0,
      } as Record<string, number>;

      receivableBills.forEach((bill) => {
        const outstanding = getOutstandingAmount(bill.totalAmount, bill.paidAmount);
        if (outstanding <= 0) return;
        const bucket = getAgingBucket(bill.dueDate, periodEnd);
        if (bucket === 'current') agingBuckets.Current += outstanding;
        if (bucket === 'days1To30') agingBuckets['1-30 Days'] += outstanding;
        if (bucket === 'days31To60') agingBuckets['31-60 Days'] += outstanding;
        if (bucket === 'days61To90') agingBuckets['61-90 Days'] += outstanding;
        if (bucket === 'days90Plus') agingBuckets['90+ Days'] += outstanding;
      });

      return sendWorkbook(res, 'pnl-report.xlsx', [
        {
          name: 'Summary',
          rows: [{
            FromDate: formatExcelDate(fromDate),
            ToDate: formatExcelDate(toDate),
            BilledIncome: totalBilledIncome,
            CollectedIncome: totalCollectedIncome,
            TotalExpenses: totalExpenses,
            NetProfitLoss: netProfitLoss,
            CashSurplus: cashSurplus,
            Receivables: receivableBills.reduce((sum, bill) => sum + getOutstandingAmount(bill.totalAmount, bill.paidAmount), 0),
            MaintenanceBilling: billedIncomeByKind.maintenance,
            OpeningBalanceBilling: billedIncomeByKind.openingBalance,
            SpecialChargeBilling: billedIncomeByKind.special,
          }],
        },
        {
          name: 'Billed Income',
          rows: billedBills.map((bill) => ({
            Flat: bill.flat.flatNumber,
            Block: bill.flat.block.name,
            BillKind: bill.billKind,
            Title: bill.title || '',
            DueDate: formatExcelDate(bill.dueDate),
            TotalAmount: bill.totalAmount,
            PaidAmount: bill.paidAmount,
            OutstandingAmount: getOutstandingAmount(bill.totalAmount, bill.paidAmount),
            BaseAmount: bill.baseAmount,
            WaterCharge: bill.waterCharge,
            ParkingCharge: bill.parkingCharge,
            SinkingFund: bill.sinkingFund,
            RepairFund: bill.repairFund,
            OtherCharges: bill.otherCharges,
            LateFee: bill.lateFee,
            Status: bill.status,
          })),
        },
        {
          name: 'Billing Categories',
          rows: [
            { Category: 'Maintenance', Amount: billedIncomeByKind.maintenance },
            { Category: 'Opening Balance', Amount: billedIncomeByKind.openingBalance },
            { Category: 'Special Charges', Amount: billedIncomeByKind.special },
            { Category: 'Fines', Amount: specialChargeBreakdown.fine },
            { Category: 'Damage', Amount: specialChargeBreakdown.damage },
            { Category: 'Common Item Breakage', Amount: specialChargeBreakdown.commonItemBreakage },
            { Category: 'Other Special', Amount: specialChargeBreakdown.other },
          ],
        },
        {
          name: 'Collections',
          rows: payments.map((payment) => ({
            Flat: payment.bill.flat.flatNumber,
            Block: payment.bill.flat.block.name,
            Amount: payment.amount,
            Method: payment.method,
            PaidAt: payment.paidAt ? new Date(payment.paidAt).toLocaleString('en-IN') : '',
            TransactionId: payment.transactionId || payment.receiptNo || '',
          })),
        },
        {
          name: 'Expenses',
          rows: expenses.map((expense) => ({
            Description: expense.description,
            Category: expense.category,
            Amount: expense.amount,
            ExpenseDate: formatExcelDate(expense.expenseDate),
            AccountingMonth: `${expense.accountingMonth}/${expense.accountingYear}`,
          })),
        },
        {
          name: 'Receivables Aging',
          rows: Object.entries(agingBuckets).map(([bucket, amount]) => ({
            Bucket: bucket,
            OutstandingAmount: amount,
          })),
        },
      ]);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to export P&L report' });
    }
  },
);

export default router;
