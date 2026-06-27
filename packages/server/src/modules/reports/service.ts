import { Response } from 'express';
import * as XLSX from 'xlsx';
import prisma from '../../config/database';

export function getMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function getAccountingMonthKey(accountingYear: number, accountingMonth: number) {
  return `${accountingYear}-${String(accountingMonth).padStart(2, '0')}`;
}

function getAccountingPeriodsBetween(fromDate: Date, toDate: Date) {
  const periods: Array<{ accountingYear: number; accountingMonth: number }> = [];
  const cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
  const end = new Date(toDate.getFullYear(), toDate.getMonth(), 1);

  while (cursor <= end) {
    periods.push({
      accountingYear: cursor.getFullYear(),
      accountingMonth: cursor.getMonth() + 1,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return periods;
}

export function buildAccountingPeriodWhere(fromDate?: Date, toDate?: Date) {
  if (!fromDate || !toDate) {
    return undefined;
  }

  const periods = getAccountingPeriodsBetween(fromDate, toDate);
  if (periods.length === 1) {
    return periods[0];
  }

  return { OR: periods };
}

export function addToBucket(bucket: Record<string, number>, key: string, amount: number) {
  bucket[key] = (bucket[key] || 0) + amount;
}

export function getOutstandingAmount(totalAmount: number, paidAmount: number) {
  return Math.max(totalAmount - paidAmount, 0);
}

export function getProratedCollectedAmount(componentAmount: number, totalAmount: number, paidAmount: number) {
  if (componentAmount <= 0 || totalAmount <= 0 || paidAmount <= 0) {
    return 0;
  }

  return (Math.min(paidAmount, totalAmount) * componentAmount) / totalAmount;
}

export function createBilledIncomeBreakdown() {
  return {
    baseAmount: 0,
    waterCharge: 0,
    parkingCharge: 0,
    sinkingFund: 0,
    repairFund: 0,
    otherCharges: 0,
    lateFee: 0,
    openingBalance: 0,
    specialCharges: 0,
  };
}

export function createBillKindBreakdown() {
  return {
    maintenance: 0,
    openingBalance: 0,
    special: 0,
  };
}

export function createSpecialChargeBreakdown() {
  return {
    openingBalance: 0,
    fine: 0,
    damage: 0,
    commonItemBreakage: 0,
    other: 0,
  };
}

export function applyBillBreakdown(
  bill: {
    billKind?: 'MAINTENANCE' | 'OPENING_BALANCE' | 'SPECIAL';
    baseAmount: number;
    waterCharge: number;
    parkingCharge: number;
    sinkingFund: number;
    repairFund: number;
    otherCharges: number;
    lateFee: number;
    totalAmount: number;
    lineItems?: Array<{ category: 'MAINTENANCE_COMPONENT' | 'OPENING_BALANCE' | 'FINE' | 'DAMAGE' | 'COMMON_ITEM_BREAKAGE' | 'OTHER'; label: string; amount: number }>;
  },
  billedIncomeByComponent: ReturnType<typeof createBilledIncomeBreakdown>,
  billedIncomeByKind: ReturnType<typeof createBillKindBreakdown>,
  specialChargeBreakdown: ReturnType<typeof createSpecialChargeBreakdown>,
) {
  if (!bill.lineItems?.length) {
    billedIncomeByComponent.baseAmount += bill.baseAmount;
    billedIncomeByComponent.waterCharge += bill.waterCharge;
    billedIncomeByComponent.parkingCharge += bill.parkingCharge;
    billedIncomeByComponent.sinkingFund += bill.sinkingFund;
    billedIncomeByComponent.repairFund += bill.repairFund;
    billedIncomeByComponent.otherCharges += bill.otherCharges;
    billedIncomeByComponent.lateFee += bill.lateFee;

    if (bill.billKind === 'OPENING_BALANCE') {
      billedIncomeByComponent.openingBalance += bill.totalAmount;
      billedIncomeByKind.openingBalance += bill.totalAmount;
      specialChargeBreakdown.openingBalance += bill.totalAmount;
    } else if (bill.billKind === 'SPECIAL') {
      billedIncomeByComponent.specialCharges += bill.totalAmount;
      billedIncomeByKind.special += bill.totalAmount;
      specialChargeBreakdown.other += bill.totalAmount;
    } else {
      billedIncomeByKind.maintenance += bill.totalAmount;
    }
    return;
  }

  let maintenanceAmount = 0;
  let openingBalanceAmount = 0;
  let specialAmount = 0;

  bill.lineItems.forEach((item) => {
    switch (item.category) {
      case 'MAINTENANCE_COMPONENT': {
        maintenanceAmount += item.amount;
        const normalized = item.label.toLowerCase();
        if (normalized.includes('base')) billedIncomeByComponent.baseAmount += item.amount;
        else if (normalized.includes('water')) billedIncomeByComponent.waterCharge += item.amount;
        else if (normalized.includes('parking')) billedIncomeByComponent.parkingCharge += item.amount;
        else if (normalized.includes('sinking')) billedIncomeByComponent.sinkingFund += item.amount;
        else if (normalized.includes('repair')) billedIncomeByComponent.repairFund += item.amount;
        else billedIncomeByComponent.otherCharges += item.amount;
        break;
      }
      case 'OPENING_BALANCE':
        openingBalanceAmount += item.amount;
        billedIncomeByComponent.openingBalance += item.amount;
        specialChargeBreakdown.openingBalance += item.amount;
        break;
      case 'FINE':
        specialAmount += item.amount;
        billedIncomeByComponent.specialCharges += item.amount;
        specialChargeBreakdown.fine += item.amount;
        break;
      case 'DAMAGE':
        specialAmount += item.amount;
        billedIncomeByComponent.specialCharges += item.amount;
        specialChargeBreakdown.damage += item.amount;
        break;
      case 'COMMON_ITEM_BREAKAGE':
        specialAmount += item.amount;
        billedIncomeByComponent.specialCharges += item.amount;
        specialChargeBreakdown.commonItemBreakage += item.amount;
        break;
      case 'OTHER':
        if (bill.billKind === 'SPECIAL') {
          specialAmount += item.amount;
          billedIncomeByComponent.specialCharges += item.amount;
          specialChargeBreakdown.other += item.amount;
        } else {
          maintenanceAmount += item.amount;
          billedIncomeByComponent.otherCharges += item.amount;
        }
        break;
      default:
        break;
    }
  });

  billedIncomeByComponent.lateFee += bill.lateFee;
  if (bill.lateFee > 0) {
    maintenanceAmount += bill.lateFee;
  }

  billedIncomeByKind.maintenance += maintenanceAmount;
  billedIncomeByKind.openingBalance += openingBalanceAmount;
  billedIncomeByKind.special += specialAmount;
}

export function getAgingBucket(dueDate: Date, asOfDate: Date) {
  const dayMs = 24 * 60 * 60 * 1000;
  const daysPastDue = Math.floor((asOfDate.getTime() - dueDate.getTime()) / dayMs);

  if (daysPastDue <= 0) return 'current';
  if (daysPastDue <= 30) return 'days1To30';
  if (daysPastDue <= 60) return 'days31To60';
  if (daysPastDue <= 90) return 'days61To90';
  return 'days90Plus';
}

export function formatExcelDate(value?: Date | string | null) {
  if (!value) {
    return '';
  }

  return new Date(value).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function sendWorkbook(res: Response, filename: string, sheets: Array<{ name: string; rows: Array<Record<string, any>> }>) {
  const workbook = XLSX.utils.book_new();

  sheets.forEach((sheet) => {
    const worksheet = XLSX.utils.json_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  });

  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(buffer);
}

function matchesResidentFilters(
  resident: { name?: string | null; phone?: string | null; carNumber?: string | null },
  filters: { name?: string; mobile?: string; carNumber?: string },
) {
  const normalizedName = (filters.name || '').trim().toLowerCase();
  const normalizedMobile = (filters.mobile || '').trim().toLowerCase();
  const normalizedCarNumber = (filters.carNumber || '').trim().toLowerCase();

  if (normalizedName && !(resident.name || '').toLowerCase().includes(normalizedName)) {
    return false;
  }

  if (normalizedMobile && !(resident.phone || '').toLowerCase().includes(normalizedMobile)) {
    return false;
  }

  if (normalizedCarNumber && !(resident.carNumber || '').toLowerCase().includes(normalizedCarNumber)) {
    return false;
  }

  return true;
}

export async function getResidentReportRows(
  societyId: string,
  filters: { name?: string; mobile?: string; carNumber?: string },
) {
  const flats = await prisma.flat.findMany({
    where: { block: { societyId } },
    include: {
      block: { select: { name: true } },
      owner: {
        select: {
          name: true,
          phone: true,
          email: true,
          carNumber: true,
          twoWheelerNumber: true,
        },
      },
      tenant: {
        select: {
          name: true,
          phone: true,
          email: true,
          carNumber: true,
          twoWheelerNumber: true,
          isActive: true,
        },
      },
    },
    orderBy: [{ block: { name: 'asc' } }, { flatNumber: 'asc' }],
  });

  return flats.flatMap((flat) => {
    if (!flat.isOccupied) {
      return [];
    }

    if (flat.tenant?.isActive) {
      return matchesResidentFilters(flat.tenant, filters)
        ? [{
            relation: 'TENANT',
            name: flat.tenant.name,
            mobile: flat.tenant.phone,
            email: flat.tenant.email || '',
            carNumber: flat.tenant.carNumber || '',
            twoWheelerNumber: flat.tenant.twoWheelerNumber || '',
            flatNumber: flat.flatNumber,
            blockName: flat.block?.name || '',
          }]
        : [];
    }

    if (flat.owner && matchesResidentFilters(flat.owner, filters)) {
      return [{
        relation: 'OWNER',
        name: flat.owner.name,
        mobile: flat.owner.phone,
        email: flat.owner.email || '',
        carNumber: flat.owner.carNumber || '',
        twoWheelerNumber: flat.owner.twoWheelerNumber || '',
        flatNumber: flat.flatNumber,
        blockName: flat.block?.name || '',
      }];
    }

    return [];
  });
}