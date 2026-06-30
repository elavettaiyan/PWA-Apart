import crypto from 'crypto';
import { config } from '../../config';
import prisma from '../../config/database';
import logger from '../../config/logger';
import { sendPaymentReceiptEmail, PaymentReceiptData } from '../../config/email';

export const BULK_REF_PREFIX = 'BULK:';
export const PHONEPE_SDK_MARKER = '|SDK';
export const SINGLE_PHONEPE_SDK_NOTE = `PHONEPE${PHONEPE_SDK_MARKER}`;

const phonePeAuthTokenCache = new Map<string, { accessToken: string; expiresAt: number }>();
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export type PaymentGatewayKind = 'PHONEPE' | 'RAZORPAY';

export type PhonePeGatewayConfig = {
  gateway: 'PHONEPE';
  merchantId: string;
  clientId: string;
  clientSecret: string;
  clientVersion: number;
  saltKey: string;
  saltIndex: number;
  environment: string;
  baseUrl: string;
  redirectUrl: string;
  callbackUrl: string;
  source: 'database' | 'environment';
  isActive?: boolean;
};

export type RazorpayGatewayConfig = {
  gateway: 'RAZORPAY';
  merchantId: string;
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  environment: string;
  baseUrl: string;
  redirectUrl: string;
  callbackUrl: string;
  source: 'database' | 'environment';
  isActive?: boolean;
};

export type ResolvedGatewayConfig = PhonePeGatewayConfig | RazorpayGatewayConfig;

export function bulkRef(merchantTransId: string) {
  return `${BULK_REF_PREFIX}${merchantTransId}`;
}

export function withSdkMarker(note: string) {
  return `${note}${PHONEPE_SDK_MARKER}`;
}

export function isBulkPayment(notes?: string | null) {
  return typeof notes === 'string' && notes.startsWith(BULK_REF_PREFIX);
}

export function isPhonePeSdkFlow(notes?: string | null) {
  return typeof notes === 'string' && (notes === SINGLE_PHONEPE_SDK_NOTE || notes.endsWith(PHONEPE_SDK_MARKER));
}

export function getBulkPaymentNotes(merchantTransId: string) {
  const reference = bulkRef(merchantTransId);
  return [reference, withSdkMarker(reference)];
}

function getPhonePeSdkBaseUrl(environment: string) {
  return environment === 'PRODUCTION'
    ? 'https://api.phonepe.com/apis/pg'
    : 'https://api-preprod.phonepe.com/apis/pg-sandbox';
}

function getPhonePeAuthBaseUrl(environment: string) {
  return environment === 'PRODUCTION'
    ? 'https://api.phonepe.com/apis/identity-manager'
    : 'https://api-preprod.phonepe.com/apis/pg-sandbox';
}

function getPhonePeBaseUrl(environment: string) {
  return environment === 'PRODUCTION'
    ? 'https://api.phonepe.com/apis/hermes'
    : 'https://api-preprod.phonepe.com/apis/pg-sandbox';
}

function getDefaultRazorpayRedirectUrl() {
  return `${config.clientUrl}/billing?payment=done`;
}

function getDefaultRazorpayCallbackUrl() {
  return `${config.publicServerUrl}/api/payments/razorpay/webhook`;
}

async function getGatewayConfigFromDatabase(societyId: string, gateway: PaymentGatewayKind, includeInactive = false) {
  return prisma.paymentGatewayConfig.findUnique({
    where: { societyId_gateway: { societyId, gateway } },
  });
}

export async function getActivePaymentGatewayConfig(societyId: string | null): Promise<ResolvedGatewayConfig> {
  if (societyId) {
    const activeConfig = await prisma.paymentGatewayConfig.findFirst({
      where: { societyId, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (activeConfig?.gateway === 'RAZORPAY') {
      return {
        gateway: 'RAZORPAY',
        merchantId: activeConfig.merchantId,
        keyId: activeConfig.keyId || '',
        keySecret: activeConfig.keySecret || '',
        webhookSecret: activeConfig.webhookSecret || '',
        environment: activeConfig.environment,
        baseUrl: activeConfig.baseUrl || config.razorpay.baseUrl,
        redirectUrl: activeConfig.redirectUrl || getDefaultRazorpayRedirectUrl(),
        callbackUrl: activeConfig.callbackUrl || getDefaultRazorpayCallbackUrl(),
        source: 'database',
        isActive: activeConfig.isActive,
      };
    }

    if (activeConfig?.gateway === 'PHONEPE') {
      return {
        gateway: 'PHONEPE',
        merchantId: activeConfig.merchantId,
        clientId: activeConfig.clientId || '',
        clientSecret: activeConfig.clientSecret || '',
        clientVersion: activeConfig.clientVersion,
        saltKey: activeConfig.saltKey,
        saltIndex: activeConfig.saltIndex,
        environment: activeConfig.environment,
        baseUrl: activeConfig.baseUrl,
        redirectUrl: activeConfig.redirectUrl,
        callbackUrl: activeConfig.callbackUrl,
        source: 'database',
        isActive: activeConfig.isActive,
      };
    }
  }

  return getPhonePeConfig(societyId);
}

export async function getPhonePeConfig(societyId: string | null, options?: { includeInactive?: boolean }): Promise<PhonePeGatewayConfig> {
  if (societyId) {
    const dbConfig = await getGatewayConfigFromDatabase(societyId, 'PHONEPE', options?.includeInactive);
    if (dbConfig && (options?.includeInactive || dbConfig.isActive)) {
      return {
        gateway: 'PHONEPE',
        merchantId: dbConfig.merchantId,
        clientId: dbConfig.clientId || '',
        clientSecret: dbConfig.clientSecret || '',
        clientVersion: dbConfig.clientVersion,
        saltKey: dbConfig.saltKey,
        saltIndex: dbConfig.saltIndex,
        environment: dbConfig.environment,
        baseUrl: dbConfig.baseUrl,
        redirectUrl: dbConfig.redirectUrl,
        callbackUrl: dbConfig.callbackUrl,
        source: 'database' as const,
        isActive: dbConfig.isActive,
      };
    }
  }

  return {
    gateway: 'PHONEPE',
    merchantId: config.phonepe.merchantId,
    clientId: config.phonepe.clientId,
    clientSecret: config.phonepe.clientSecret,
    clientVersion: config.phonepe.clientVersion,
    saltKey: config.phonepe.saltKey,
    saltIndex: config.phonepe.saltIndex,
    environment: config.phonepe.env,
    baseUrl: config.phonepe.baseUrl,
    redirectUrl: config.phonepe.redirectUrl,
    callbackUrl: config.phonepe.callbackUrl,
    source: 'environment' as const,
  };
}

export async function getRazorpayConfig(societyId: string | null, options?: { includeInactive?: boolean }): Promise<RazorpayGatewayConfig> {
  if (societyId) {
    const dbConfig = await getGatewayConfigFromDatabase(societyId, 'RAZORPAY', options?.includeInactive);
    if (dbConfig && (options?.includeInactive || dbConfig.isActive)) {
      return {
        gateway: 'RAZORPAY',
        merchantId: dbConfig.merchantId,
        keyId: dbConfig.keyId || '',
        keySecret: dbConfig.keySecret || '',
        webhookSecret: dbConfig.webhookSecret || '',
        environment: dbConfig.environment,
        baseUrl: dbConfig.baseUrl || config.razorpay.baseUrl,
        redirectUrl: dbConfig.redirectUrl || getDefaultRazorpayRedirectUrl(),
        callbackUrl: dbConfig.callbackUrl || getDefaultRazorpayCallbackUrl(),
        source: 'database' as const,
        isActive: dbConfig.isActive,
      };
    }
  }

  return {
    gateway: 'RAZORPAY',
    merchantId: '',
    keyId: config.razorpay.keyId,
    keySecret: config.razorpay.keySecret,
    webhookSecret: config.razorpay.webhookSecret,
    environment: 'PRODUCTION',
    baseUrl: config.razorpay.baseUrl,
    redirectUrl: getDefaultRazorpayRedirectUrl(),
    callbackUrl: getDefaultRazorpayCallbackUrl(),
    source: 'environment' as const,
  };
}

export async function createRazorpayOrder(
  pgConfig: RazorpayGatewayConfig,
  payload: Record<string, unknown>,
) {
  if (!pgConfig.keyId || !pgConfig.keySecret) {
    throw new Error('Razorpay credentials are not configured');
  }

  const credentials = Buffer.from(`${pgConfig.keyId}:${pgConfig.keySecret}`).toString('base64');
  const response = await fetch(`${pgConfig.baseUrl}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) as Record<string, any> : {};

  if (!response.ok || !data.id) {
    throw new Error(data?.error?.description || data?.message || 'Failed to create Razorpay order');
  }

  return data;
}

export async function fetchRazorpayPayment(
  pgConfig: RazorpayGatewayConfig,
  paymentId: string,
) {
  if (!pgConfig.keyId || !pgConfig.keySecret) {
    throw new Error('Razorpay credentials are not configured');
  }

  const credentials = Buffer.from(`${pgConfig.keyId}:${pgConfig.keySecret}`).toString('base64');
  const response = await fetch(`${pgConfig.baseUrl}/payments/${paymentId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${credentials}`,
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) as Record<string, any> : {};

  if (!response.ok || !data.id) {
    throw new Error(data?.error?.description || data?.message || 'Failed to fetch Razorpay payment');
  }

  return data;
}

export function verifyRazorpaySignature({
  orderId,
  paymentId,
  signature,
  secret,
}: {
  orderId: string;
  paymentId: string;
  signature: string;
  secret: string;
}) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  return expectedSignature === signature;
}

async function getPhonePeAuthToken(pgConfig: Awaited<ReturnType<typeof getPhonePeConfig>>) {
  if (!pgConfig.clientId || !pgConfig.clientSecret) {
    throw new Error('PhonePe SDK client credentials are not configured');
  }

  const cacheKey = `${pgConfig.environment}:${pgConfig.clientId}:${pgConfig.merchantId}`;
  const cached = phonePeAuthTokenCache.get(cacheKey);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - 60 > now) {
    return cached.accessToken;
  }

  const requestBody = new URLSearchParams({
    client_id: pgConfig.clientId,
    client_version: String(pgConfig.clientVersion || 1),
    client_secret: pgConfig.clientSecret,
    grant_type: 'client_credentials',
  });

  const response = await fetch(`${getPhonePeAuthBaseUrl(pgConfig.environment)}/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: requestBody.toString(),
  });

  const data = await response.json() as { access_token?: string; expires_at?: number; message?: string; error?: string };
  if (!response.ok || !data.access_token) {
    throw new Error(data.message || data.error || 'Failed to generate PhonePe auth token');
  }

  phonePeAuthTokenCache.set(cacheKey, {
    accessToken: data.access_token,
    expiresAt: data.expires_at || now + 300,
  });

  return data.access_token;
}

export async function createPhonePeSdkOrder(
  pgConfig: Awaited<ReturnType<typeof getPhonePeConfig>>,
  payload: Record<string, unknown>,
) {
  const authToken = await getPhonePeAuthToken(pgConfig);
  const response = await fetch(`${getPhonePeSdkBaseUrl(pgConfig.environment)}/checkout/v2/sdk/order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `O-Bearer ${authToken}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json() as { orderId?: string; token?: string; message?: string; code?: string };
  if (!response.ok || !data.orderId || !data.token) {
    throw new Error(data.message || data.code || 'Failed to create PhonePe SDK order');
  }

  return data;
}

export type PhonePeSdkOrderStatus = {
  state?: 'PENDING' | 'FAILED' | 'COMPLETED';
  paymentDetails?: Array<{ transactionId?: string; state?: string }>;
  message?: string;
  code?: string;
};

export async function fetchPhonePeSdkOrderStatus(
  pgConfig: Awaited<ReturnType<typeof getPhonePeConfig>>,
  merchantOrderId: string,
  maxAttempts = 3,
): Promise<PhonePeSdkOrderStatus> {
  const authToken = await getPhonePeAuthToken(pgConfig);
  const url = `${getPhonePeSdkBaseUrl(pgConfig.environment)}/checkout/v2/order/${merchantOrderId}/status?details=true&errorContext=true`;

  const MAX_ATTEMPTS = maxAttempts;
  const RETRY_DELAY_MS = 2000;

  let lastData: PhonePeSdkOrderStatus = {};
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `O-Bearer ${authToken}`,
      },
    });

    const data = await response.json() as PhonePeSdkOrderStatus;
    logger.info('PhonePe SDK order status response:', {
      merchantOrderId,
      attempt,
      httpStatus: response.status,
      state: data.state,
      code: data.code,
      message: data.message,
    });

    lastData = data;

    if (data.state === 'COMPLETED' || data.state === 'FAILED') {
      return data;
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  return lastData;
}

export async function getUserFlatIds(userId: string, societyId: string | null) {
  if (!societyId) return [] as string[];

  const [owners, tenants] = await Promise.all([
    prisma.owner.findMany({
      where: { userId, flat: { block: { societyId } } },
      select: { flatId: true },
    }),
    prisma.tenant.findMany({
      where: { userId, flat: { block: { societyId } } },
      select: { flatId: true },
    }),
  ]);

  return [...new Set([...owners.map((row) => row.flatId), ...tenants.map((row) => row.flatId)])];
}

export async function getUserOwnedFlatIds(userId: string, societyId: string | null) {
  if (!societyId) return [] as string[];

  const owners = await prisma.owner.findMany({
    where: { userId, flat: { block: { societyId } } },
    select: { flatId: true },
  });

  return owners.map((record) => record.flatId);
}

export async function getSocietySettings(societyId: string | null) {
  if (!societyId) return null;
  return prisma.societySettings.findUnique({ where: { societyId } });
}

export function formatBillLabel(bill: { title?: string | null; month?: number | null; year?: number | null }) {
  if (bill.title) return bill.title;
  if (bill.month && bill.year) return `${MONTH_NAMES[bill.month - 1]} ${bill.year}`;
  return 'Billing due';
}

export function buildReceiptText(payment: any) {
  const bill = payment.bill;
  const flat = bill.flat;
  const lines = [
    'Dwell Hub Payment Receipt',
    '',
    `Society: ${flat.block.society?.name || '-'}`,
    `Flat: ${flat.flatNumber}, ${flat.block.name}`,
    `Bill Period: ${MONTH_NAMES[bill.month - 1]} ${bill.year}`,
    `Payment Date: ${payment.paidAt ? new Date(payment.paidAt).toLocaleString('en-IN') : payment.createdAt ? new Date(payment.createdAt).toLocaleString('en-IN') : '-'}`,
    `Payment Method: ${payment.method}`,
    `Transaction Ref: ${payment.transactionId || payment.receiptNo || payment.merchantTransId || '-'}`,
    '',
    'Bill Split-up',
    `- Base Maintenance Amount: ${bill.baseAmount.toFixed(2)}`,
    `- Water Charge: ${bill.waterCharge.toFixed(2)}`,
    `- Parking Charge: ${bill.parkingCharge.toFixed(2)}`,
    `- Sinking Fund: ${bill.sinkingFund.toFixed(2)}`,
    `- Repair Fund: ${bill.repairFund.toFixed(2)}`,
    `- Other Charges: ${bill.otherCharges.toFixed(2)}`,
    `- Late Fee: ${bill.lateFee.toFixed(2)}`,
    `- Bill Total: ${bill.totalAmount.toFixed(2)}`,
    `- Amount Paid In This Receipt: ${payment.amount.toFixed(2)}`,
    `- Total Paid On Bill: ${bill.paidAmount.toFixed(2)}`,
    `- Balance Due: ${Math.max(0, bill.totalAmount - bill.paidAmount).toFixed(2)}`,
    `- Bill Status: ${bill.status}`,
  ];

  return lines.join('\n');
}

export async function sendReceiptForPayment(paymentId: string) {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        bill: {
          include: {
            flat: {
              include: {
                owner: true,
                tenant: true,
                block: { include: { society: true } },
              },
            },
          },
        },
      },
    });

    if (!payment || payment.status !== 'SUCCESS') return;

    const bill = payment.bill;
    const flat = bill.flat;
    const owner = flat.owner;
    const tenant = flat.tenant;

    const recipient = (tenant?.isActive && tenant.email) ? { name: tenant.name, email: tenant.email }
            : (owner?.isActive !== false && owner?.email)  ? { name: owner.name,  email: owner.email }
            : null;

    if (!recipient) {
      logger.warn('Payment receipt: no email address found for flat', { flatId: flat.id, paymentId });
      return;
    }

    const data: PaymentReceiptData = {
      userName: recipient.name,
      flatNumber: flat.flatNumber,
      blockName: flat.block.name,
      societyName: flat.block.society.name,
      billMonth: formatBillLabel(bill),
      amount: payment.amount,
      totalAmount: bill.totalAmount,
      paidAmount: bill.paidAmount,
      billStatus: bill.status,
      method: payment.method,
      transactionId: payment.transactionId || payment.receiptNo || payment.merchantTransId || undefined,
      paidAt: payment.paidAt || new Date(),
    };

    await sendPaymentReceiptEmail(recipient.email, data);
  } catch (err: any) {
    logger.error('Payment receipt email failed (non-blocking)', { paymentId, error: err.message });
  }
}