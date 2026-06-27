import prisma from '../../config/database';

function getAccountingPeriodFromDate(date: Date) {
  return {
    accountingMonth: date.getMonth() + 1,
    accountingYear: date.getFullYear(),
  };
}

function getMonthDateRange(month: number, year: number) {
  return {
    fromDate: new Date(year, month - 1, 1),
    toDate: new Date(year, month, 0, 23, 59, 59, 999),
  };
}

function getAccountingPeriodLabel(month: number, year: number) {
  return new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1));
}

const hasPartialAccountingPeriod = (body: Record<string, any>) => {
  return (body.accountingMonth && !body.accountingYear) || (!body.accountingMonth && body.accountingYear);
};

export const hasInvalidAccountingPeriodPair = hasPartialAccountingPeriod;

export const listExpenses = async (params: { societyId: string | null; query: Record<string, any> }) => {
  const where: any = {};
  const month = params.query.month ? Number(params.query.month) : undefined;
  const year = params.query.year ? Number(params.query.year) : undefined;

  if (params.societyId) where.societyId = params.societyId;
  if (params.query.category) where.category = params.query.category;

  if (month && year) {
    where.accountingMonth = month;
    where.accountingYear = year;
  }

  if (params.query.fromDate || params.query.toDate) {
    where.expenseDate = {};
    if (params.query.fromDate) where.expenseDate.gte = new Date(params.query.fromDate as string);
    if (params.query.toDate) where.expenseDate.lte = new Date(params.query.toDate as string);
  }

  const expenses = await prisma.expense.findMany({
    where,
    orderBy: [
      { accountingYear: 'desc' },
      { accountingMonth: 'desc' },
      { expenseDate: 'desc' },
    ],
  });

  const summary = await prisma.expense.groupBy({
    by: ['category'],
    where,
    _sum: { amount: true },
    _count: true,
  });

  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);

  return {
    expenses,
    summary,
    total,
    selectedPeriod: month && year
      ? {
        accountingMonth: month,
        accountingYear: year,
        label: getAccountingPeriodLabel(month, year),
        ...getMonthDateRange(month, year),
      }
      : null,
  };
};

export const findExpenseById = (id: string) => {
  return prisma.expense.findUnique({
    where: { id },
  });
};

export const createExpense = (params: {
  societyId: string;
  approvedBy: string;
  body: Record<string, any>;
  receiptUrl: string | null;
}) => {
  const expenseDate = new Date(params.body.expenseDate);
  const accountingPeriod = params.body.accountingMonth && params.body.accountingYear
    ? {
      accountingMonth: Number(params.body.accountingMonth),
      accountingYear: Number(params.body.accountingYear),
    }
    : getAccountingPeriodFromDate(expenseDate);

  return prisma.expense.create({
    data: {
      societyId: params.societyId,
      category: params.body.category,
      amount: parseFloat(params.body.amount),
      description: params.body.description,
      vendor: params.body.vendor || null,
      receiptUrl: params.receiptUrl,
      expenseDate,
      accountingMonth: accountingPeriod.accountingMonth,
      accountingYear: accountingPeriod.accountingYear,
      approvedBy: params.approvedBy,
    },
  });
};

export const updateExpense = (id: string, existing: { expenseDate: Date; accountingMonth: number; accountingYear: number }, body: Record<string, any>) => {
  const expenseDate = body.expenseDate ? new Date(body.expenseDate) : existing.expenseDate;
  const accountingPeriod = body.accountingMonth && body.accountingYear
    ? {
      accountingMonth: Number(body.accountingMonth),
      accountingYear: Number(body.accountingYear),
    }
    : {
      accountingMonth: existing.accountingMonth,
      accountingYear: existing.accountingYear,
    };

  return prisma.expense.update({
    where: { id },
    data: {
      category: body.category,
      amount: body.amount ? parseFloat(body.amount) : undefined,
      description: body.description,
      vendor: body.vendor,
      expenseDate: body.expenseDate ? expenseDate : undefined,
      accountingMonth: body.accountingMonth || body.accountingYear || body.expenseDate
        ? accountingPeriod.accountingMonth
        : undefined,
      accountingYear: body.accountingMonth || body.accountingYear || body.expenseDate
        ? accountingPeriod.accountingYear
        : undefined,
    },
  });
};

export const deleteExpense = (id: string) => {
  return prisma.expense.delete({ where: { id } });
};