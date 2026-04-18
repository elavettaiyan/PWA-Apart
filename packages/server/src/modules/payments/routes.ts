import { Request, Response, Router } from 'express';
import { body } from 'express-validator';
import type { Prisma } from '@prisma/client';
import { config } from '../../config';
import prisma from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import logger from '../../config/logger';
import { v4 as uuidv4 } from 'uuid';
import { calculateBillPaymentUpdate, generateChecksum, verifyCallbackChecksum } from './phonepeUtils';
import { sendPaymentReceiptEmail, PaymentReceiptData } from '../../config/email';
import { notifyPaymentSuccess } from '../notifications/service';

const router = Router();
const BULK_REF_PREFIX = 'BULK:'; // Prefix in payment.notes to link bulk payments without merchantTransId on each record
const PHONEPE_SDK_MARKER = '|SDK';
const SINGLE_PHONEPE_SDK_NOTE = `PHONEPE${PHONEPE_SDK_MARKER}`;
const phonePeAuthTokenCache = new Map<string, { accessToken: string; expiresAt: number }>();


function bulkRef(merchantTransId: string) {
  return `${BULK_REF_PREFIX}${merchantTransId}`;
}

function withSdkMarker(note: string) {
  return `${note}${PHONEPE_SDK_MARKER}`;
}

function isBulkPayment(notes?: string | null) {
  return typeof notes === 'string' && notes.startsWith(BULK_REF_PREFIX);
}

function isPhonePeSdkFlow(notes?: string | null) {
  return typeof notes === 'string' && (notes === SINGLE_PHONEPE_SDK_NOTE || notes.endsWith(PHONEPE_SDK_MARKER));
}

function getBulkPaymentNotes(merchantTransId: string) {
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

// Helper: get PhonePe config from DB for a society, fallback to env
async function getPhonePeConfig(societyId: string | null) {
  if (societyId) {
    const dbConfig = await prisma.paymentGatewayConfig.findUnique({
      where: { societyId_gateway: { societyId, gateway: 'PHONEPE' } },
    });
    if (dbConfig && dbConfig.isActive) {
      return {
        merchantId: dbConfig.merchantId,
        clientId: dbConfig.clientId,
        clientSecret: dbConfig.clientSecret,
        clientVersion: dbConfig.clientVersion,
        saltKey: dbConfig.saltKey,
        saltIndex: dbConfig.saltIndex,
        environment: dbConfig.environment,
        baseUrl: dbConfig.baseUrl,
        redirectUrl: dbConfig.redirectUrl,
        callbackUrl: dbConfig.callbackUrl,
        source: 'database' as const,
      };
    }
  }
  // Fallback to env config
  return {
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

async function createPhonePeSdkOrder(
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

async function fetchPhonePeSdkOrderStatus(
  pgConfig: Awaited<ReturnType<typeof getPhonePeConfig>>,
  merchantOrderId: string,
) {
  const authToken = await getPhonePeAuthToken(pgConfig);
  const response = await fetch(
    `${getPhonePeSdkBaseUrl(pgConfig.environment)}/checkout/v2/order/${merchantOrderId}/status?details=false&errorContext=true`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `O-Bearer ${authToken}`,
      },
    },
  );

  return response.json() as Promise<{
    state?: 'PENDING' | 'FAILED' | 'COMPLETED';
    paymentDetails?: Array<{ transactionId?: string; state?: string }>;
    message?: string;
    code?: string;
  }>;
}

async function markPaymentSuccess(paymentId: string, transactionId: string | undefined, phonepePayload: unknown) {
  return prisma.$transaction(async (tx) => {
    const existingPayment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { bill: true },
    });

    if (!existingPayment) {
      throw new Error(`Payment not found: ${paymentId}`);
    }

    if (existingPayment.status === 'SUCCESS') {
      return { alreadyProcessed: true };
    }

    // Use updateMany with status guard to prevent double-processing race condition.
    // If two callbacks arrive simultaneously, only one will match status != 'SUCCESS'.
    const updated = await tx.payment.updateMany({
      where: { id: existingPayment.id, status: { not: 'SUCCESS' } },
      data: {
        status: 'SUCCESS',
        transactionId,
        phonepeResponse: JSON.stringify(phonepePayload),
        paidAt: new Date(),
      },
    });

    if (updated.count === 0) {
      return { alreadyProcessed: true };
    }

    const { newPaidAmount, newStatus } = calculateBillPaymentUpdate(
      existingPayment.bill.paidAmount,
      existingPayment.bill.totalAmount,
      existingPayment.amount,
    );

    await tx.maintenanceBill.update({
      where: { id: existingPayment.bill.id },
      data: { paidAmount: newPaidAmount, status: newStatus },
    });

    return { alreadyProcessed: false };
  });
}

async function getUserFlatIds(userId: string, societyId: string | null) {
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

async function markBulkPaymentsSuccess(merchantTransId: string, transactionId: string | undefined, phonepePayload: unknown) {
  const references = getBulkPaymentNotes(merchantTransId);

  return prisma.$transaction(async (tx) => {
    const linkedPayments = await tx.payment.findMany({
      where: {
        OR: [
          { merchantTransId },
          { notes: { in: references } },
        ],
      },
      include: { bill: true },
    });

    if (linkedPayments.length === 0) {
      throw new Error(`Bulk payment not found: ${merchantTransId}`);
    }

    let processedCount = 0;
    const processedPaymentIds: string[] = [];

    for (const payment of linkedPayments) {
      if (payment.status === 'SUCCESS') continue;

      const { newPaidAmount, newStatus } = calculateBillPaymentUpdate(
        payment.bill.paidAmount,
        payment.bill.totalAmount,
        payment.amount,
      );

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCESS',
          transactionId: payment.merchantTransId === merchantTransId ? transactionId : undefined,
          phonepeResponse: JSON.stringify(phonepePayload),
          paidAt: new Date(),
        },
      });

      await tx.maintenanceBill.update({
        where: { id: payment.bill.id },
        data: { paidAmount: newPaidAmount, status: newStatus },
      });

      processedCount++;
      processedPaymentIds.push(payment.id);
    }

    return { processedCount, processedPaymentIds };
  });
}

async function markBulkPaymentsFailed(merchantTransId: string, phonepePayload: unknown) {
  const references = getBulkPaymentNotes(merchantTransId);

  await prisma.payment.updateMany({
    where: {
      status: 'INITIATED',
      OR: [
        { merchantTransId },
        { notes: { in: references } },
      ],
    },
    data: {
      status: 'FAILED',
      phonepeResponse: JSON.stringify(phonepePayload),
    },
  });
}

// ── INITIATE PHONEPE PAYMENT ────────────────────────────

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/** Fire-and-forget receipt email for a successfully processed payment. */
async function sendReceiptForPayment(paymentId: string) {
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

    // Determine who to email — prefer tenant if active, else owner
    const recipient = (tenant?.email) ? { name: tenant.name, email: tenant.email }
                    : (owner?.email)  ? { name: owner.name,  email: owner.email }
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
      billMonth: `${MONTH_NAMES[bill.month - 1]} ${bill.year}`,
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

router.post(
  '/phonepe/initiate',
  authenticate,
  [body('billId').isUUID(), body('nativeSdk').optional().isBoolean()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const bill = await prisma.maintenanceBill.findUnique({
        where: { id: req.body.billId },
        include: { flat: { include: { owner: true, block: true } } },
      });

      if (!bill) return res.status(404).json({ error: 'Bill not found' });
      if (bill.status === 'PAID') return res.status(400).json({ error: 'Bill already paid' });

      const billSocietyId = bill.flat.block.societyId;
      if (req.user!.role !== 'SUPER_ADMIN' && req.user!.societyId !== billSocietyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (req.user!.role === 'OWNER' || req.user!.role === 'TENANT') {
        const userFlatIds = await getUserFlatIds(req.user!.id, req.user!.societyId ?? null);
        if (!userFlatIds.includes(bill.flatId)) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      const amountToPay = bill.totalAmount - bill.paidAmount;
      const merchantTransId = `MT${Date.now()}${uuidv4().slice(0, 8).toUpperCase()}`;
      const nativeSdk = req.body.nativeSdk === true;

      // Get PhonePe config from DB or env
      const pgConfig = await getPhonePeConfig(req.user!.societyId ?? null);
      if (!pgConfig.merchantId) {
        return res.status(400).json({ error: 'PhonePe Merchant ID is not configured. Ask your admin to update payment gateway settings.' });
      }
      if (nativeSdk && (!pgConfig.clientId || !pgConfig.clientSecret)) {
        return res.status(400).json({ error: 'PhonePe Android SDK credentials are not configured. Add Client ID and Client Secret in settings.' });
      }
      if (!nativeSdk && !pgConfig.saltKey) {
        return res.status(400).json({ error: 'PhonePe Salt Key is not configured for web redirect payments. Add it in settings or use the Android SDK flow.' });
      }

      // Create payment record
      const payment = await prisma.payment.create({
        data: {
          billId: bill.id,
          amount: amountToPay,
          method: 'PHONEPE',
          status: 'INITIATED',
          merchantTransId,
          notes: nativeSdk ? SINGLE_PHONEPE_SDK_NOTE : undefined,
        },
      });

      if (nativeSdk) {
        try {
          const sdkOrder = await createPhonePeSdkOrder(pgConfig, {
            merchantOrderId: merchantTransId,
            amount: Math.round(amountToPay * 100),
            expireAfter: 1200,
            metaInfo: {
              udf1: payment.id,
              udf2: bill.id,
              udf3: req.user!.id,
              udf4: billSocietyId,
            },
            paymentFlow: {
              type: 'PG_CHECKOUT',
            },
          });

          await prisma.payment.update({
            where: { id: payment.id },
            data: { phonepeResponse: JSON.stringify(sdkOrder) },
          });

          return res.json({
            success: true,
            paymentId: payment.id,
            merchantTransId,
            nativeSdk: true,
            orderId: sdkOrder.orderId,
            token: sdkOrder.token,
            sdkContext: {
              merchantId: pgConfig.merchantId,
              environment: pgConfig.environment,
            },
          });
        } catch (error: any) {
          await prisma.payment.update({
            where: { id: payment.id },
            data: { status: 'FAILED', phonepeResponse: JSON.stringify({ error: error.message }) },
          });

          logger.error('PhonePe SDK initiation failed:', error);
          return res.status(400).json({
            error: error.message || 'Payment initiation failed',
          });
        }
      }

      // PhonePe Standard Checkout Payload
      const payload = {
        merchantId: pgConfig.merchantId,
        merchantTransactionId: merchantTransId,
        merchantUserId: req.user!.id,
        amount: Math.round(amountToPay * 100), // in paise
        redirectUrl: `${pgConfig.redirectUrl}${pgConfig.redirectUrl.includes('?') ? '&' : '?'}txnId=${merchantTransId}`,
        redirectMode: 'REDIRECT',
        callbackUrl: pgConfig.callbackUrl,
        paymentInstrument: {
          type: 'PAY_PAGE',
        },
      };

      const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64');
      const checksum = generateChecksum(payloadBase64, '/pg/v1/pay', pgConfig.saltKey, pgConfig.saltIndex);

      // Call PhonePe API
      const phonePeResponse = await fetch(`${pgConfig.baseUrl}/pg/v1/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-VERIFY': checksum,
        },
        body: JSON.stringify({ request: payloadBase64 }),
      });

      const phonePeData: any = await phonePeResponse.json();

      if (phonePeData.success) {
        const redirectUrl =
          phonePeData.data?.instrumentResponse?.redirectInfo?.url;

        return res.json({
          success: true,
          paymentId: payment.id,
          merchantTransId,
          redirectUrl,
        });
      } else {
        // Update payment as failed
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'FAILED', phonepeResponse: JSON.stringify(phonePeData) },
        });

        logger.error('PhonePe initiation failed:', phonePeData);
        return res.status(400).json({
          error: 'Payment initiation failed',
          details: phonePeData.message,
        });
      }
    } catch (error) {
      logger.error('PhonePe payment error:', error);
      return res.status(500).json({ error: 'Payment initiation failed' });
    }
  },
);

// ── INITIATE BULK PHONEPE PAYMENT ──────────────────────
router.post(
  '/phonepe/initiate-bulk',
  authenticate,
  [
    body('billIds').isArray({ min: 2 }).withMessage('At least two bills are required for bulk payment'),
    body('nativeSdk').optional().isBoolean(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const incomingBillIds: unknown[] = Array.isArray(req.body.billIds) ? req.body.billIds : [];
      const billIds = Array.from(new Set(incomingBillIds)).filter((id): id is string => typeof id === 'string');

      if (billIds.length < 2) {
        return res.status(400).json({ error: 'Select at least two bills for bulk payment' });
      }

      type BillWithFlat = Prisma.MaintenanceBillGetPayload<{ include: { flat: { include: { block: true } } } }>;
      const bills: BillWithFlat[] = await prisma.maintenanceBill.findMany({
        where: { id: { in: billIds } },
        include: { flat: { include: { block: true } } },
      });

      if (bills.length !== billIds.length) {
        return res.status(404).json({ error: 'One or more bills were not found' });
      }

      const societyIds = new Set(bills.map((bill) => bill.flat.block.societyId));
      if (societyIds.size !== 1) {
        return res.status(400).json({ error: 'Bulk payment supports bills from one society only' });
      }

      const targetSocietyId = bills[0].flat.block.societyId;
      if (req.user!.role !== 'SUPER_ADMIN' && req.user!.societyId !== targetSocietyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (req.user!.role === 'OWNER' || req.user!.role === 'TENANT') {
        const userFlatIds = await getUserFlatIds(req.user!.id, req.user!.societyId ?? null);
        const hasForeignBill = bills.some((bill) => !userFlatIds.includes(bill.flatId));
        if (hasForeignBill) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      const payableBills = bills
        .map((bill) => ({
          bill,
          dueAmount: Math.max(bill.totalAmount - bill.paidAmount, 0),
        }))
        .filter((row) => row.dueAmount > 0 && row.bill.status !== 'PAID');

      if (payableBills.length < 2) {
        return res.status(400).json({ error: 'Select at least two unpaid bills for bulk payment' });
      }

      const merchantTransId = `MTB${Date.now()}${uuidv4().slice(0, 8).toUpperCase()}`;
      const bulkReference = bulkRef(merchantTransId);
      const nativeSdk = req.body.nativeSdk === true;
      const totalAmount = payableBills.reduce((sum, row) => sum + row.dueAmount, 0);

      const pgConfig = await getPhonePeConfig(req.user!.societyId ?? targetSocietyId ?? null);
      if (!pgConfig.merchantId) {
        return res.status(400).json({ error: 'PhonePe Merchant ID is not configured. Ask your admin to update payment gateway settings.' });
      }
      if (nativeSdk && (!pgConfig.clientId || !pgConfig.clientSecret)) {
        return res.status(400).json({ error: 'PhonePe Android SDK credentials are not configured. Add Client ID and Client Secret in settings.' });
      }
      if (!nativeSdk && !pgConfig.saltKey) {
        return res.status(400).json({ error: 'PhonePe Salt Key is not configured for web redirect payments. Add it in settings or use the Android SDK flow.' });
      }

      const paymentNotes = nativeSdk ? withSdkMarker(bulkReference) : bulkReference;

      await prisma.$transaction(async (tx) => {
        for (let index = 0; index < payableBills.length; index++) {
          const row = payableBills[index];
          await tx.payment.create({
            data: {
              billId: row.bill.id,
              amount: row.dueAmount,
              method: 'PHONEPE',
              status: 'INITIATED',
              merchantTransId: index === 0 ? merchantTransId : null,
              notes: paymentNotes,
            },
          });
        }
      });

      if (nativeSdk) {
        try {
          const sdkOrder = await createPhonePeSdkOrder(pgConfig, {
            merchantOrderId: merchantTransId,
            amount: Math.round(totalAmount * 100),
            expireAfter: 1200,
            metaInfo: {
              udf1: merchantTransId,
              udf2: String(payableBills.length),
              udf3: req.user!.id,
              udf4: targetSocietyId,
            },
            paymentFlow: {
              type: 'PG_CHECKOUT',
            },
          });

          return res.json({
            success: true,
            merchantTransId,
            billCount: payableBills.length,
            totalAmount,
            nativeSdk: true,
            orderId: sdkOrder.orderId,
            token: sdkOrder.token,
            sdkContext: {
              merchantId: pgConfig.merchantId,
              environment: pgConfig.environment,
            },
          });
        } catch (error: any) {
          await markBulkPaymentsFailed(merchantTransId, { error: error.message });
          logger.error('PhonePe SDK bulk initiation failed:', error);
          return res.status(400).json({ error: error.message || 'Bulk payment initiation failed' });
        }
      }

      const payload = {
        merchantId: pgConfig.merchantId,
        merchantTransactionId: merchantTransId,
        merchantUserId: req.user!.id,
        amount: Math.round(totalAmount * 100),
        redirectUrl: `${pgConfig.redirectUrl}${pgConfig.redirectUrl.includes('?') ? '&' : '?'}txnId=${merchantTransId}`,
        redirectMode: 'REDIRECT',
        callbackUrl: pgConfig.callbackUrl,
        paymentInstrument: {
          type: 'PAY_PAGE',
        },
      };

      const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64');
      const checksum = generateChecksum(payloadBase64, '/pg/v1/pay', pgConfig.saltKey, pgConfig.saltIndex);

      const phonePeResponse = await fetch(`${pgConfig.baseUrl}/pg/v1/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-VERIFY': checksum,
        },
        body: JSON.stringify({ request: payloadBase64 }),
      });

      const phonePeData: any = await phonePeResponse.json();

      if (phonePeData.success) {
        return res.json({
          success: true,
          merchantTransId,
          redirectUrl: phonePeData.data?.instrumentResponse?.redirectInfo?.url,
          billCount: payableBills.length,
          totalAmount,
        });
      }

      await markBulkPaymentsFailed(merchantTransId, phonePeData);
      logger.error('PhonePe bulk initiation failed:', phonePeData);
      return res.status(400).json({
        error: 'Bulk payment initiation failed',
        details: phonePeData.message,
      });
    } catch (error) {
      logger.error('PhonePe bulk payment error:', error);
      return res.status(500).json({ error: 'Bulk payment initiation failed' });
    }
  },
);

// ── PHONEPE CALLBACK (Server-to-Server) ─────────────────
router.post('/phonepe/callback', async (req: Request, res: Response) => {
  try {
    const { response } = req.body;

    if (!response) {
      return res.status(400).json({ error: 'Invalid callback' });
    }

    // Verify checksum
    const receivedChecksum = req.headers['x-verify'] as string;

    // We need to find the society to get the salt key for verification
    // Decode response first to get merchantTransactionId
    const decodedResponse = JSON.parse(
      Buffer.from(response, 'base64').toString('utf-8'),
    );

    logger.info('PhonePe callback received:', decodedResponse);

    const merchantTransId = decodedResponse.data?.merchantTransactionId;
    if (!merchantTransId) {
      return res.status(400).json({ error: 'Invalid transaction ID' });
    }

    const payment = await prisma.payment.findUnique({
      where: { merchantTransId },
      include: { bill: { include: { flat: { include: { block: true } } } } },
    });

    if (!payment) {
      logger.error('Payment not found for txn:', merchantTransId);
      return res.status(404).json({ error: 'Payment not found' });
    }

    // SECURITY: Require a valid callback signature before any payment state change.
    const societyId = payment.bill?.flat?.block?.societyId;
    const pgConfig = await getPhonePeConfig(societyId ?? null);
    if (!receivedChecksum) {
      logger.error('PhonePe callback missing checksum', { merchantTransId });
      return res.status(400).json({ error: 'Checksum verification failed' });
    }

    if (!verifyCallbackChecksum(response, receivedChecksum, pgConfig.saltKey, pgConfig.saltIndex)) {
      logger.error('PhonePe callback checksum mismatch', { merchantTransId, received: receivedChecksum });
      return res.status(400).json({ error: 'Checksum verification failed' });
    }

    const txnStatus = decodedResponse.code;

    if (txnStatus === 'PAYMENT_SUCCESS') {
      if (isBulkPayment(payment.notes)) {
        const result = await markBulkPaymentsSuccess(merchantTransId, decodedResponse.data?.transactionId, decodedResponse);
        logger.info(`Bulk payment successful: ${merchantTransId}`, { processedCount: result.processedCount });

        for (const paymentId of result.processedPaymentIds) {
          sendReceiptForPayment(paymentId).catch(() => {});
          notifyPaymentSuccess(paymentId).catch(() => {});
        }
      } else {
        const result = await markPaymentSuccess(payment.id, decodedResponse.data?.transactionId, decodedResponse);
        logger.info(`Payment successful: ${merchantTransId}`, { alreadyProcessed: result.alreadyProcessed });

        if (!result.alreadyProcessed) {
          sendReceiptForPayment(payment.id).catch(() => {});
          notifyPaymentSuccess(payment.id).catch(() => {});
        }
      }
    } else {
      if (isBulkPayment(payment.notes)) {
        await markBulkPaymentsFailed(merchantTransId, decodedResponse);
      } else {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            phonepeResponse: JSON.stringify(decodedResponse),
          },
        });
      }

      logger.warn(`Payment failed: ${merchantTransId} - ${txnStatus}`);
    }

    return res.json({ success: true });
  } catch (error) {
    logger.error('PhonePe callback error:', error);
    return res.status(500).json({ error: 'Callback processing failed' });
  }
});

// ── CHECK PAYMENT STATUS ────────────────────────────────
router.get(
  '/status/:merchantTransId',
  authenticate,
  async (req: AuthRequest, res) => {
    try {
      const { merchantTransId } = req.params;

      const payment = await prisma.payment.findUnique({
        where: { merchantTransId },
        include: {
          bill: {
            include: { flat: { include: { block: { select: { id: true, name: true, societyId: true } } } } },
          },
        },
      });

      if (!payment) {
        return res.status(404).json({ error: 'Payment not found' });
      }

      // SECURITY: Verify the requesting user owns this payment's society
      const paymentSocietyId = payment.bill?.flat?.block?.societyId;
      if (req.user!.role !== 'SUPER_ADMIN' && paymentSocietyId && paymentSocietyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (req.user!.role === 'OWNER' || req.user!.role === 'TENANT') {
        const userFlatIds = await getUserFlatIds(req.user!.id, req.user!.societyId ?? null);
        if (!userFlatIds.includes(payment.bill.flatId)) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      // If still INITIATED, check with PhonePe
      if (payment.status === 'INITIATED') {
        // Determine societyId from bill's flat block
        const societyId = payment.bill?.flat?.block?.societyId || req.user!.societyId;
        const pgConfig = await getPhonePeConfig(societyId ?? null);

        if (isPhonePeSdkFlow(payment.notes)) {
          try {
            const statusData = await fetchPhonePeSdkOrderStatus(pgConfig, merchantTransId);

            if (statusData.state === 'COMPLETED') {
              const transactionId = statusData.paymentDetails?.[0]?.transactionId;

              if (isBulkPayment(payment.notes)) {
                const result = await markBulkPaymentsSuccess(merchantTransId, transactionId, statusData);

                for (const paymentId of result.processedPaymentIds) {
                  sendReceiptForPayment(paymentId).catch(() => {});
                  notifyPaymentSuccess(paymentId).catch(() => {});
                }
                return res.json({ ...payment, status: 'SUCCESS', bulkProcessedCount: result.processedCount });
              }

              const result = await markPaymentSuccess(payment.id, transactionId, statusData);
              if (!result.alreadyProcessed) {
                sendReceiptForPayment(payment.id).catch(() => {});
                notifyPaymentSuccess(payment.id).catch(() => {});
              }
              return res.json({ ...payment, status: 'SUCCESS', alreadyProcessed: result.alreadyProcessed });
            }

            if (statusData.state === 'FAILED') {
              if (isBulkPayment(payment.notes)) {
                await markBulkPaymentsFailed(merchantTransId, statusData);
              } else {
                await prisma.payment.update({
                  where: { id: payment.id },
                  data: {
                    status: 'FAILED',
                    phonepeResponse: JSON.stringify(statusData),
                  },
                });
              }

              return res.json({ ...payment, status: 'FAILED' });
            }
          } catch (e) {
            logger.warn('SDK status check to PhonePe failed:', e);
          }
        } else {
          const checksum = generateChecksum(
            '',
            `/pg/v1/status/${pgConfig.merchantId}/${merchantTransId}`,
            pgConfig.saltKey,
            pgConfig.saltIndex,
          );

          try {
            const statusResponse = await fetch(
              `${pgConfig.baseUrl}/pg/v1/status/${pgConfig.merchantId}/${merchantTransId}`,
              {
                method: 'GET',
                headers: { 'X-VERIFY': checksum, 'X-MERCHANT-ID': pgConfig.merchantId },
              },
            );

            const statusData: any = await statusResponse.json();

            if (statusData.code === 'PAYMENT_SUCCESS') {
              if (isBulkPayment(payment.notes)) {
                const result = await markBulkPaymentsSuccess(merchantTransId, statusData.data?.transactionId, statusData);

                for (const paymentId of result.processedPaymentIds) {
                  sendReceiptForPayment(paymentId).catch(() => {});
                  notifyPaymentSuccess(paymentId).catch(() => {});
                }
                return res.json({ ...payment, status: 'SUCCESS', bulkProcessedCount: result.processedCount });
              }

              const result = await markPaymentSuccess(payment.id, statusData.data?.transactionId, statusData);
              if (!result.alreadyProcessed) {
                sendReceiptForPayment(payment.id).catch(() => {});
                notifyPaymentSuccess(payment.id).catch(() => {});
              }
              return res.json({ ...payment, status: 'SUCCESS', alreadyProcessed: result.alreadyProcessed });
            }
          } catch (e) {
            logger.warn('Status check to PhonePe failed:', e);
          }
        }
      }

      return res.json(payment);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to check payment status' });
    }
  },
);

// ── HELPER: Generate PhonePe Checksum ───────────────────
// (moved to top of file as shared helper)

export default router;
