import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import logger from '../../config/logger';
import { sendPaymentReceiptEmail, PaymentReceiptData } from '../../config/email';

export const nowMs = () => Date.now();

type ConfigSummaryCache = { data: any; expiresAt: number };
const configSummaryCache = new Map<string, ConfigSummaryCache>();
const CONFIG_SUMMARY_TTL = 60_000;

export const ALL_FLAT_TYPES = ['ONE_BHK', 'TWO_BHK', 'THREE_BHK', 'FOUR_BHK', 'STUDIO', 'PENTHOUSE', 'SHOP', 'OTHER'] as const;
export const BILL_KINDS = ['MAINTENANCE', 'OPENING_BALANCE', 'SPECIAL'] as const;
export const BILL_LINE_ITEM_CATEGORIES = ['MAINTENANCE_COMPONENT', 'OPENING_BALANCE', 'FINE', 'DAMAGE', 'COMMON_ITEM_BREAKAGE', 'OTHER'] as const;
export const CUSTOM_BILLING_MODES = ['OPENING_BALANCE', 'STANDALONE_SPECIAL'] as const;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function getCachedConfigSummary(societyId: string) {
  const entry = configSummaryCache.get(societyId);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  configSummaryCache.delete(societyId);
  return null;
}

export function setCachedConfigSummary(societyId: string, data: any) {
  configSummaryCache.set(societyId, { data, expiresAt: Date.now() + CONFIG_SUMMARY_TTL });
}

export function invalidateConfigSummaryCache(societyId: string) {
  configSummaryCache.delete(societyId);
}

export function normalizeSharedConfig(societyId: string, configs: Array<any>) {
  const activeConfigs = configs.filter((config) => config.isActive !== false);
  const primaryConfig = activeConfigs[0];

  return {
    societyId,
    isConfigured: activeConfigs.length > 0,
    baseAmount: primaryConfig?.baseAmount ?? 0,
    waterCharge: primaryConfig?.waterCharge ?? 0,
    parkingCharge: primaryConfig?.parkingCharge ?? 0,
    sinkingFund: primaryConfig?.sinkingFund ?? 0,
    repairFund: primaryConfig?.repairFund ?? 0,
    otherCharges: primaryConfig?.otherCharges ?? 0,
    lateFeePerDay: primaryConfig?.lateFeePerDay ?? 0,
    lateFeeAmount: primaryConfig?.lateFeeAmount ?? 0,
    recurringLateFeeAmount: primaryConfig?.recurringLateFeeAmount ?? 0,
    configuredFlatTypes: activeConfigs.map((config) => config.flatType),
    totalMonthlyAmount:
      (primaryConfig?.baseAmount ?? 0) +
      (primaryConfig?.waterCharge ?? 0) +
      (primaryConfig?.parkingCharge ?? 0) +
      (primaryConfig?.sinkingFund ?? 0) +
      (primaryConfig?.repairFund ?? 0) +
      (primaryConfig?.otherCharges ?? 0),
  };
}

export function buildMaintenanceLineItems(config: {
  baseAmount: number;
  waterCharge: number;
  parkingCharge: number;
  sinkingFund: number;
  repairFund: number;
  otherCharges: number;
}) {
  return [
    { label: 'Base Maintenance', amount: Number(config.baseAmount || 0) },
    { label: 'Water Charge', amount: Number(config.waterCharge || 0) },
    { label: 'Parking Charge', amount: Number(config.parkingCharge || 0) },
    { label: 'Sinking Fund', amount: Number(config.sinkingFund || 0) },
    { label: 'Repair Fund', amount: Number(config.repairFund || 0) },
    { label: 'Other Charges', amount: Number(config.otherCharges || 0) },
  ]
    .filter((item) => item.amount > 0)
    .map((item, index) => ({ label: item.label, amount: item.amount, category: 'MAINTENANCE_COMPONENT' as const, sortOrder: index }));
}

export function normalizeBillStatus(totalAmount: number, paidAmount: number, dueDate: Date) {
  if (paidAmount >= totalAmount) return 'PAID';
  if (paidAmount > 0) return 'PARTIAL';
  return dueDate.getTime() < Date.now() ? 'OVERDUE' : 'PENDING';
}

export function resolveDueDateForPeriod(month: number, year: number, dueDay: number) {
  const normalizedDueDay = Math.min(Math.max(Number(dueDay || 10), 1), 28);
  return new Date(year, month - 1, normalizedDueDay);
}

function buildBillLabel(bill: {
  billKind?: string | null;
  title?: string | null;
  month?: number | null;
  year?: number | null;
  appliesToMonth?: number | null;
  appliesToYear?: number | null;
}) {
  if (bill.title) return bill.title;
  const labelMonth = bill.appliesToMonth ?? bill.month;
  const labelYear = bill.appliesToYear ?? bill.year;
  if (bill.billKind === 'OPENING_BALANCE') return 'Opening Balance';
  if (bill.billKind === 'SPECIAL') return labelMonth && labelYear ? `Special Bill - ${labelMonth}/${labelYear}` : 'Special Bill';
  return labelMonth && labelYear ? `Monthly Maintenance - ${labelMonth}/${labelYear}` : 'Maintenance Bill';
}

function buildBillPeriodText(bill: {
  billKind?: string | null;
  title?: string | null;
  month?: number | null;
  year?: number | null;
  appliesToMonth?: number | null;
  appliesToYear?: number | null;
}) {
  const labelMonth = bill.appliesToMonth ?? bill.month;
  const labelYear = bill.appliesToYear ?? bill.year;
  if (labelMonth && labelYear) return `${MONTH_NAMES[labelMonth - 1]} ${labelYear}`;
  return buildBillLabel(bill);
}

export async function sendBillingReceiptForPayment(paymentId: string) {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { bill: { include: { flat: { include: { owner: true, tenant: true, block: { include: { society: true } } } } } } },
    });

    if (!payment || payment.status !== 'SUCCESS') return;

    const fullBill = payment.bill;
    const flat = fullBill.flat;
    const recipient = flat.tenant?.isActive && flat.tenant.email
      ? { name: flat.tenant.name, email: flat.tenant.email }
      : flat.owner && flat.owner.isActive !== false && flat.owner.email
        ? { name: flat.owner.name, email: flat.owner.email }
        : null;

    if (!recipient) return;

    const receiptData: PaymentReceiptData = {
      userName: recipient.name,
      flatNumber: flat.flatNumber,
      blockName: flat.block.name,
      societyName: flat.block.society.name,
      billMonth: buildBillPeriodText(fullBill),
      amount: payment.amount,
      totalAmount: fullBill.totalAmount,
      paidAmount: fullBill.paidAmount,
      billStatus: fullBill.status,
      method: payment.method,
      transactionId: payment.transactionId || payment.receiptNo || payment.merchantTransId || undefined,
      paidAt: payment.paidAt || new Date(),
    };

    await sendPaymentReceiptEmail(recipient.email, receiptData);
  } catch (error: any) {
    logger.error('Billing payment receipt email failed (non-blocking)', { paymentId, error: error.message });
  }
}

export function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function getUserFlatIds(userId: string, societyId: string) {
  const [owners, tenants] = await Promise.all([
    prisma.owner.findMany({ where: { userId, flat: { block: { societyId } } }, select: { flatId: true } }),
    prisma.tenant.findMany({ where: { userId, flat: { block: { societyId } } }, select: { flatId: true } }),
  ]);

  return [...new Set([...owners.map((owner) => owner.flatId), ...tenants.map((tenant) => tenant.flatId)])];
}

export async function getUserOwnedFlatIds(userId: string, societyId: string) {
  const owners = await prisma.owner.findMany({
    where: { userId, flat: { block: { societyId } } },
    select: { flatId: true },
  });

  return [...new Set(owners.map((owner) => owner.flatId))];
}