import { Request, Response, Router } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest, FINANCIAL_ROLES } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import logger from '../../config/logger';
import { v4 as uuidv4 } from 'uuid';
import { calculateBillPaymentUpdate, generateChecksum, verifyCallbackChecksum } from './phonepeUtils';
import { allocatePayment } from '../collections/service';
import { notifyPaymentSuccess } from '../notifications/service';
import {
  bulkRef,
  buildReceiptText,
  createPhonePeSdkOrder,
  fetchPhonePeSdkOrderStatus,
  getBulkPaymentNotes,
  getPhonePeConfig,
  getSocietySettings,
  getUserFlatIds,
  getUserOwnedFlatIds,
  isBulkPayment,
  isPhonePeSdkFlow,
  sendReceiptForPayment,
  SINGLE_PHONEPE_SDK_NOTE,
  withSdkMarker,
} from './service';
import {
  initiateBulkPhonePePaymentValidation,
  initiatePhonePeAmountValidation,
  initiatePhonePePaymentValidation,
  paymentHistoryValidation,
  paymentReportValidation,
  phonePeSdkConfirmValidation,
} from './validation';

const router = Router();

async function markPaymentSuccess(paymentId: string, transactionId: string | undefined, phonepePayload: unknown, gatewayRefId?: string) {
  // Mark payment SUCCESS in a guarded update, then allocate the amount to bills.
  const existingPayment = await prisma.payment.findUnique({
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
  const updated = await prisma.payment.updateMany({
    where: { id: existingPayment.id, status: { not: 'SUCCESS' } },
    data: {
      status: 'SUCCESS',
      transactionId,
      gatewayRefId: gatewayRefId ?? undefined,
      phonepeResponse: JSON.stringify(phonepePayload),
      paidAt: new Date(),
    },
  });

  if (updated.count === 0) {
    return { alreadyProcessed: true };
  }

  // Allocate the payment amount across outstanding bills for the flat (oldest-first).
  try {
    const flatId = existingPayment.bill.flatId;
    await allocatePayment(flatId, existingPayment.amount);
  } catch (err: any) {
    logger.error('markPaymentSuccess: allocation failed', { paymentId, error: err?.message });
  }

  return { alreadyProcessed: false };
}

async function markBulkPaymentsSuccess(merchantTransId: string, transactionId: string | undefined, phonepePayload: unknown, gatewayRefId?: string) {
  const references = getBulkPaymentNotes(merchantTransId);

  // Mark payments SUCCESS inside a transaction and collect processed payments,
  // then run allocation outside the transaction to avoid nested transactions.
  const txResult = await prisma.$transaction(async (tx) => {
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
    const processedPayments: Array<{ id: string; amount: number; flatId: string }> = [];
    const touchedFlatIds = new Set<string>();

    for (const payment of linkedPayments) {
      const updatedPayment = await tx.payment.updateMany({
        where: { id: payment.id, status: { not: 'SUCCESS' } },
        data: {
          status: 'SUCCESS',
          transactionId: payment.merchantTransId === merchantTransId ? transactionId : undefined,
          gatewayRefId: gatewayRefId ?? undefined,
          phonepeResponse: JSON.stringify(phonepePayload),
          paidAt: new Date(),
        },
      });

      if (updatedPayment.count === 0) {
        continue;
      }

      processedCount++;
      touchedFlatIds.add(payment.bill.flatId);
      processedPayments.push({ id: payment.id, amount: payment.amount, flatId: payment.bill.flatId });
    }

    return { processedCount, processedPayments, touchedFlatIds: [...touchedFlatIds] };
  });

  // Allocate one consolidated amount per flat outside the transaction.
  const totalsByFlat = new Map<string, number>();
  for (const p of txResult.processedPayments) {
    totalsByFlat.set(p.flatId, Number(((totalsByFlat.get(p.flatId) || 0) + p.amount).toFixed(2)));
  }

  for (const [flatId, amount] of totalsByFlat.entries()) {
    try {
      await allocatePayment(flatId, amount);
    } catch (err: any) {
      logger.error('markBulkPaymentsSuccess: allocation failed for flat', { flatId, amount, error: err?.message });
    }
  }

  return { processedCount: txResult.processedCount, processedPaymentIds: txResult.processedPayments.map((p) => p.id) };
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

router.post(
  '/phonepe/initiate',
  authenticate,
  initiatePhonePePaymentValidation,
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
        return res.status(400).json({ error: 'PhonePe SDK credentials (Client ID and Client Secret) are not configured. Ask your admin to add them in payment gateway settings.' });
      }
      if (!nativeSdk && !pgConfig.saltKey) {
        return res.status(400).json({ error: 'PhonePe Salt Key is not configured for web redirect payments. Add it in settings.' });
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
          error: phonePeData.message || 'Payment initiation failed',
          code: phonePeData.code,
        });
      }
    } catch (error) {
      logger.error('PhonePe payment error:', error);
      return res.status(500).json({ error: 'Payment initiation failed' });
    }
  },
);

router.post(
  '/phonepe/initiate-amount',
  authenticate,
  initiatePhonePeAmountValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { flatId, nativeSdk = false } = req.body;
      const requestedAmount = Number(req.body.amount);

      const flat = await prisma.flat.findUnique({
        where: { id: flatId },
        include: { block: true },
      });

      if (!flat) return res.status(404).json({ error: 'Flat not found' });

      const societyId = flat.block.societyId;
      if (req.user!.role !== 'SUPER_ADMIN' && req.user!.societyId !== societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (req.user!.role === 'OWNER' || req.user!.role === 'TENANT') {
        const userFlatIds = await getUserFlatIds(req.user!.id, req.user!.societyId ?? null);
        if (!userFlatIds.includes(flatId)) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      const settings = await getSocietySettings(societyId);
      const bills = await prisma.maintenanceBill.findMany({
        where: { flatId },
        orderBy: [{ year: 'asc' }, { month: 'asc' }],
      });

      const outstandingBills = bills.filter((bill) => Number((bill.totalAmount - bill.paidAmount).toFixed(2)) > 0);
      const anchorBill = outstandingBills[0] ?? bills[bills.length - 1];
      if (!anchorBill) {
        return res.status(400).json({ error: 'No bills found for this flat' });
      }

      const totalOutstanding = Number(
        outstandingBills.reduce((sum, bill) => sum + Math.max(0, bill.totalAmount - bill.paidAmount), 0).toFixed(2),
      );

      if (settings?.partialPaymentAllowed === false && requestedAmount < totalOutstanding) {
        return res.status(400).json({ error: 'Partial payments are disabled for this association' });
      }

      if (settings?.advancePaymentAllowed === false && requestedAmount > totalOutstanding) {
        return res.status(400).json({ error: 'Advance payments are disabled for this association' });
      }

      const merchantTransId = `MTA${Date.now()}${uuidv4().slice(0, 8).toUpperCase()}`;
      const pgConfig = await getPhonePeConfig(societyId);
      if (!pgConfig.merchantId) {
        return res.status(400).json({ error: 'PhonePe Merchant ID is not configured. Ask your admin to update payment gateway settings.' });
      }
      if (nativeSdk && (!pgConfig.clientId || !pgConfig.clientSecret)) {
        return res.status(400).json({ error: 'PhonePe SDK credentials (Client ID and Client Secret) are not configured. Ask your admin to add them in payment gateway settings.' });
      }
      if (!nativeSdk && !pgConfig.saltKey) {
        return res.status(400).json({ error: 'PhonePe Salt Key is not configured for web redirect payments. Add it in settings.' });
      }

      const payment = await prisma.payment.create({
        data: {
          billId: anchorBill.id,
          amount: requestedAmount,
          method: 'PHONEPE',
          status: 'INITIATED',
          merchantTransId,
          notes: nativeSdk ? SINGLE_PHONEPE_SDK_NOTE : 'AUTO_ALLOCATE',
        },
      });

      if (nativeSdk) {
        try {
          const sdkOrder = await createPhonePeSdkOrder(pgConfig, {
            merchantOrderId: merchantTransId,
            amount: Math.round(requestedAmount * 100),
            expireAfter: 1200,
            metaInfo: {
              udf1: payment.id,
              udf2: anchorBill.id,
              udf3: req.user!.id,
              udf4: societyId,
            },
            paymentFlow: { type: 'PG_CHECKOUT' },
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

          logger.error('PhonePe amount-based SDK initiation failed:', error);
          return res.status(400).json({ error: error.message || 'Payment initiation failed' });
        }
      }

      const payload = {
        merchantId: pgConfig.merchantId,
        merchantTransactionId: merchantTransId,
        merchantUserId: req.user!.id,
        amount: Math.round(requestedAmount * 100),
        redirectUrl: `${pgConfig.redirectUrl}${pgConfig.redirectUrl.includes('?') ? '&' : '?'}txnId=${merchantTransId}`,
        redirectMode: 'REDIRECT',
        callbackUrl: pgConfig.callbackUrl,
        paymentInstrument: { type: 'PAY_PAGE' },
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
          paymentId: payment.id,
          merchantTransId,
          redirectUrl: phonePeData.data?.instrumentResponse?.redirectInfo?.url,
        });
      }

      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', phonepeResponse: JSON.stringify(phonePeData) },
      });

      logger.error('PhonePe amount-based initiation failed:', phonePeData);
      return res.status(400).json({
        error: phonePeData.message || 'Payment initiation failed',
        code: phonePeData.code,
      });
    } catch (error) {
      logger.error('PhonePe amount-based payment error:', error);
      return res.status(500).json({ error: 'Payment initiation failed' });
    }
  },
);

// ── INITIATE BULK PHONEPE PAYMENT ──────────────────────
router.post(
  '/phonepe/initiate-bulk',
  authenticate,
  initiateBulkPhonePePaymentValidation,
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
        return res.status(400).json({ error: 'PhonePe SDK credentials (Client ID and Client Secret) are not configured. Ask your admin to add them in payment gateway settings.' });
      }
      if (!nativeSdk && !pgConfig.saltKey) {
        return res.status(400).json({ error: 'PhonePe Salt Key is not configured for web redirect payments. Add it in settings.' });
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
        error: phonePeData.message || 'Bulk payment initiation failed',
        code: phonePeData.code,
      });
    } catch (error) {
      logger.error('PhonePe bulk payment error:', error);
      return res.status(500).json({ error: 'Bulk payment initiation failed' });
    }
  },
);

// ── PHONEPE SDK CONFIRM (native SDK success signal) ─────
// Called by the native app immediately after the SDK fires a success callback.
// Attempts PhonePe status API verification; if PhonePe still shows PENDING (sandbox delay),
// trusts the SDK signal and marks the payment SUCCESS with a logged warning.
router.post(
  '/phonepe/sdk-confirm',
  authenticate,
  phonePeSdkConfirmValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    const { merchantTransId, transactionId: sdkTransactionId, state: sdkState } = req.body;

    logger.info('[SDK-Confirm] received', { merchantTransId, sdkTransactionId, sdkState });

    try {
      const payment = await prisma.payment.findUnique({
        where: { merchantTransId },
        include: { bill: { include: { flat: { include: { block: true } } } } },
      });

      if (!payment) {
        logger.error('[SDK-Confirm] payment not found', { merchantTransId });
        return res.status(404).json({ error: 'Payment not found' });
      }

      const societyId = payment.bill?.flat?.block?.societyId;
      if (req.user!.role !== 'SUPER_ADMIN' && societyId && societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (req.user!.role === 'OWNER' || req.user!.role === 'TENANT') {
        const userFlatIds = await getUserFlatIds(req.user!.id, req.user!.societyId ?? null);
        if (!userFlatIds.includes(payment.bill.flatId)) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      if (payment.status === 'SUCCESS') {
        logger.info('[SDK-Confirm] already SUCCESS', { merchantTransId });
        return res.json({ status: 'SUCCESS', alreadyProcessed: true });
      }

      if (!isPhonePeSdkFlow(payment.notes)) {
        logger.error('[SDK-Confirm] not an SDK payment', { merchantTransId, notes: payment.notes });
        return res.status(400).json({ error: 'Not a native SDK payment' });
      }

      // Attempt PhonePe REST status verification
      const pgConfig = await getPhonePeConfig(societyId ?? null);
      let finalTransactionId = sdkTransactionId;
      let finalGatewayRefId: string | undefined;
      let verifiedByPhonePe = false;

      try {
        // Single attempt — we trust the SDK signal either way; no need to block the user for 6s.
        const statusData = await fetchPhonePeSdkOrderStatus(pgConfig, merchantTransId, 1);
        logger.info('[SDK-Confirm] PhonePe status API result', {
          merchantTransId,
          state: statusData.state,
          code: statusData.code,
          message: statusData.message,
          paymentDetails: statusData.paymentDetails,
        });

      if (statusData.state === 'COMPLETED') {
          finalTransactionId = statusData.paymentDetails?.[0]?.transactionId || sdkTransactionId;
          finalGatewayRefId = (statusData.paymentDetails?.[0] as any)?.providerReferenceId ?? undefined;
          verifiedByPhonePe = true;
        } else if (statusData.state === 'FAILED') {
          logger.warn('[SDK-Confirm] PhonePe API says FAILED but SDK reported success', { merchantTransId, sdkState, statusData });
          if (isBulkPayment(payment.notes)) {
            await markBulkPaymentsFailed(merchantTransId, statusData);
          } else {
            await prisma.payment.update({
              where: { id: payment.id },
              data: { status: 'FAILED', phonepeResponse: JSON.stringify(statusData) },
            });
          }
          return res.status(400).json({ status: 'FAILED', error: 'PhonePe reports payment failed' });
        } else {
          // PENDING — PhonePe sandbox is slow to update; trust the SDK signal
          logger.warn('[SDK-Confirm] PhonePe API still PENDING after retries — trusting SDK success signal', {
            merchantTransId,
            sdkTransactionId,
            sdkState,
          });
        }
      } catch (e) {
        logger.warn('[SDK-Confirm] PhonePe status API call threw — trusting SDK signal', { merchantTransId, error: e });
      }

      // Mark payment SUCCESS
      if (isBulkPayment(payment.notes)) {
        const result = await markBulkPaymentsSuccess(merchantTransId, finalTransactionId, {
          source: verifiedByPhonePe ? 'phonepe_api' : 'sdk_signal',
          sdkState,
          transactionId: finalTransactionId,
          merchantTransId,
        }, finalGatewayRefId);
        for (const paymentId of result.processedPaymentIds) {
          sendReceiptForPayment(paymentId).catch(() => {});
          notifyPaymentSuccess(paymentId).catch(() => {});
        }
        logger.info('[SDK-Confirm] bulk SUCCESS', { merchantTransId, verifiedByPhonePe, count: result.processedCount });
        return res.json({ status: 'SUCCESS', bulkProcessedCount: result.processedCount });
      }

      const result = await markPaymentSuccess(payment.id, finalTransactionId, {
        source: verifiedByPhonePe ? 'phonepe_api' : 'sdk_signal',
        sdkState,
        transactionId: finalTransactionId,
        merchantTransId,
      }, finalGatewayRefId);
      if (!result.alreadyProcessed) {
        sendReceiptForPayment(payment.id).catch(() => {});
        notifyPaymentSuccess(payment.id).catch(() => {});
      }
      logger.info('[SDK-Confirm] SUCCESS', { merchantTransId, verifiedByPhonePe, alreadyProcessed: result.alreadyProcessed });
      return res.json({ status: 'SUCCESS', alreadyProcessed: result.alreadyProcessed });
    } catch (error) {
      logger.error('[SDK-Confirm] unhandled error', { merchantTransId, error });
      return res.status(500).json({ error: 'Failed to confirm payment' });
    }
  },
);

// ── PHONEPE CALLBACK (Server-to-Server) ─────────────────
router.post('/phonepe/callback', async (req: Request, res: Response) => {
  let merchantTransId: string | undefined;
  let webhookEventId: string | undefined;

  try {
    const { response } = req.body;

    if (!response) {
      return res.status(400).json({ error: 'Invalid callback' });
    }

    // Verify checksum
    const receivedChecksum = req.headers['x-verify'] as string;

    // Decode response first to get merchantTransactionId
    const decodedResponse = JSON.parse(
      Buffer.from(response, 'base64').toString('utf-8'),
    );

    logger.info('PhonePe callback received:', decodedResponse);

    merchantTransId = decodedResponse.data?.merchantTransactionId as string | undefined;
    if (!merchantTransId) {
      return res.status(400).json({ error: 'Invalid transaction ID' });
    }

    const txnStatus: string = decodedResponse.code ?? 'UNKNOWN';
    const eventKey = `${merchantTransId}:${txnStatus}`;
    const payloadStr = JSON.stringify(decodedResponse).slice(0, 4000);

    // ── IDEMPOTENCY: reject duplicate callbacks immediately ─
    let webhookEvent: { id: string } | null = null;
    try {
      webhookEvent = await prisma.webhookEvent.create({
        data: {
          id: uuidv4(),
          source: 'phonepe',
          eventKey,
          merchantTransId,
          payload: payloadStr,
          status: 'processing',
        },
        select: { id: true },
      });
      webhookEventId = webhookEvent.id;
    } catch (dupErr: any) {
      // Unique constraint violation → duplicate webhook delivery
      if (dupErr?.code === 'P2002') {
        logger.info('PhonePe callback duplicate — ignoring', { merchantTransId, eventKey });
        return res.json({ success: true, duplicate: true });
      }
      throw dupErr;
    }

    const payment = await prisma.payment.findUnique({
      where: { merchantTransId },
      include: { bill: { include: { flat: { include: { block: true } } } } },
    });

    if (!payment) {
      logger.error('Payment not found for txn:', merchantTransId);
      await prisma.webhookEvent.update({ where: { id: webhookEventId }, data: { status: 'error', error: 'Payment not found' } });
      return res.status(404).json({ error: 'Payment not found' });
    }

    // SECURITY: Require a valid callback signature before any payment state change.
    const societyId = payment.bill?.flat?.block?.societyId;
    const pgConfig = await getPhonePeConfig(societyId ?? null);
    if (!receivedChecksum) {
      logger.error('PhonePe callback missing checksum', { merchantTransId });
      await prisma.webhookEvent.update({ where: { id: webhookEventId }, data: { status: 'error', error: 'Missing checksum' } });
      return res.status(400).json({ error: 'Checksum verification failed' });
    }

    if (!verifyCallbackChecksum(response, receivedChecksum, pgConfig.saltKey, pgConfig.saltIndex)) {
      logger.error('PhonePe callback checksum mismatch', { merchantTransId, received: receivedChecksum });
      await prisma.webhookEvent.update({ where: { id: webhookEventId }, data: { status: 'error', error: 'Checksum mismatch' } });
      return res.status(400).json({ error: 'Checksum verification failed' });
    }

    const gatewayRefId: string | undefined = decodedResponse.data?.providerReferenceId ?? undefined;

    if (txnStatus === 'PAYMENT_SUCCESS') {
      if (isBulkPayment(payment.notes)) {
        const result = await markBulkPaymentsSuccess(merchantTransId, decodedResponse.data?.transactionId, decodedResponse, gatewayRefId);
        logger.info(`Bulk payment successful: ${merchantTransId}`, { processedCount: result.processedCount });

        for (const paymentId of result.processedPaymentIds) {
          sendReceiptForPayment(paymentId).catch(() => {});
          notifyPaymentSuccess(paymentId).catch(() => {});
        }
      } else {
        const result = await markPaymentSuccess(payment.id, decodedResponse.data?.transactionId, decodedResponse, gatewayRefId);
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
        // Idempotent: only update if not already in a terminal state
        await prisma.payment.updateMany({
          where: { id: payment.id, status: { notIn: ['SUCCESS', 'FAILED'] } },
          data: {
            status: 'FAILED',
            phonepeResponse: JSON.stringify(decodedResponse),
          },
        });
      }

      logger.warn(`Payment failed: ${merchantTransId} - ${txnStatus}`);
    }

    await prisma.webhookEvent.update({ where: { id: webhookEventId }, data: { status: 'processed' } });
    return res.json({ success: true });
  } catch (error: any) {
    logger.error('PhonePe callback error:', error);
    if (webhookEventId) {
      await prisma.webhookEvent.update({ where: { id: webhookEventId }, data: { status: 'error', error: String(error?.message ?? error) } }).catch(() => {});
    }
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
              const polledGatewayRefId: string | undefined = (statusData.paymentDetails?.[0] as any)?.providerReferenceId ?? undefined;

              if (isBulkPayment(payment.notes)) {
                const result = await markBulkPaymentsSuccess(merchantTransId, transactionId, statusData, polledGatewayRefId);

                for (const paymentId of result.processedPaymentIds) {
                  sendReceiptForPayment(paymentId).catch(() => {});
                  notifyPaymentSuccess(paymentId).catch(() => {});
                }
                return res.json({ ...payment, status: 'SUCCESS', bulkProcessedCount: result.processedCount });
              }

              const result = await markPaymentSuccess(payment.id, transactionId, statusData, polledGatewayRefId);
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
                await prisma.payment.updateMany({
                  where: { id: payment.id, status: { notIn: ['SUCCESS', 'FAILED'] } },
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
              const redirectGatewayRefId: string | undefined = statusData.data?.providerReferenceId ?? undefined;

              if (isBulkPayment(payment.notes)) {
                const result = await markBulkPaymentsSuccess(merchantTransId, statusData.data?.transactionId, statusData, redirectGatewayRefId);

                for (const paymentId of result.processedPaymentIds) {
                  sendReceiptForPayment(paymentId).catch(() => {});
                  notifyPaymentSuccess(paymentId).catch(() => {});
                }
                return res.json({ ...payment, status: 'SUCCESS', bulkProcessedCount: result.processedCount });
              }

              const result = await markPaymentSuccess(payment.id, statusData.data?.transactionId, statusData, redirectGatewayRefId);
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

// ── PAYMENT HISTORY ─────────────────────────────────────
// All authenticated users. Residents see only their own payments; admins see all society payments.
router.get(
  '/history',
  authenticate,
  paymentHistoryValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const page = (req.query.page as any) || 1;
      const limit = Math.min((req.query.limit as any) || 20, 100);
      const skip = (page - 1) * limit;

      const statusFilter = req.query.status as string | undefined;
      const methodFilter = req.query.method as string | undefined;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const ownerView = req.query.ownerView === 'true';

      const isAdmin = req.user!.role === 'SUPER_ADMIN' || (FINANCIAL_ROLES as readonly string[]).includes(req.user!.role);
      const isResident = req.user!.role === 'OWNER' || req.user!.role === 'TENANT';

      // Build where clause
      const where: Prisma.PaymentWhereInput = {};

      // Date range filter on paidAt or createdAt
      if (startDate || endDate) {
        where.createdAt = {
          ...(startDate ? { gte: new Date(startDate) } : {}),
          ...(endDate ? { lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)) } : {}),
        };
      }
      if (statusFilter) where.status = statusFilter as any;
      if (methodFilter) where.method = methodFilter as any;

      if (ownerView && isAdmin && req.user!.role !== 'SUPER_ADMIN') {
        const flatIds = await getUserOwnedFlatIds(req.user!.id, req.user!.societyId ?? null);
        if (flatIds.length === 0) return res.json({ payments: [], total: 0, page, limit, pages: 0 });
        where.bill = { flatId: { in: flatIds } };
      } else if (isResident) {
        // Scope to the resident's own flat IDs
        const flatIds = await getUserFlatIds(req.user!.id, req.user!.societyId ?? null);
        if (flatIds.length === 0) return res.json({ payments: [], total: 0, page, limit });
        where.bill = { flatId: { in: flatIds } };
      } else if (req.user!.role === 'SUPER_ADMIN') {
        // SUPER_ADMIN must pass ?societyId= to scope the query
        const societyId = req.query.societyId as string | undefined;
        if (!societyId) return res.status(400).json({ error: 'societyId query parameter is required for SUPER_ADMIN' });
        where.bill = { flat: { block: { societyId } } };
      } else if (isAdmin) {
        if (!req.user!.societyId) return res.status(400).json({ error: 'No society associated with your account' });
        where.bill = { flat: { block: { societyId: req.user!.societyId } } };
      }

      const [payments, total] = await Promise.all([
        prisma.payment.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          select: {
            id: true,
            billId: true,
            amount: true,
            method: true,
            status: true,
            transactionId: true,
            merchantTransId: true,
            gatewayRefId: true,
            receiptNo: true,
            paidAt: true,
            createdAt: true,
            bill: {
              select: {
                month: true,
                year: true,
                baseAmount: true,
                waterCharge: true,
                parkingCharge: true,
                sinkingFund: true,
                repairFund: true,
                otherCharges: true,
                lateFee: true,
                totalAmount: true,
                paidAmount: true,
                status: true,
                flat: {
                  select: {
                    flatNumber: true,
                    block: { select: { name: true, society: { select: { name: true } } } },
                  },
                },
              },
            },
          },
        }),
        prisma.payment.count({ where }),
      ]);

      return res.json({ payments, total, page, limit, pages: Math.ceil(total / limit) });
    } catch (error) {
      logger.error('Payment history error:', error);
      return res.status(500).json({ error: 'Failed to fetch payment history' });
    }
  },
);

router.get('/receipt/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: req.params.id },
      include: {
        bill: {
          include: {
            flat: {
              include: {
                block: { include: { society: true } },
              },
            },
          },
        },
      },
    });

    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const ownerView = req.query.ownerView === 'true';
    const isAdmin = req.user!.role === 'SUPER_ADMIN' || (FINANCIAL_ROLES as readonly string[]).includes(req.user!.role);
    const isResident = req.user!.role === 'OWNER' || req.user!.role === 'TENANT';

    if (ownerView && isAdmin && req.user!.role !== 'SUPER_ADMIN') {
      const flatIds = await getUserOwnedFlatIds(req.user!.id, req.user!.societyId ?? null);
      if (!flatIds.includes(payment.bill.flatId)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else if (isResident) {
      const flatIds = await getUserFlatIds(req.user!.id, req.user!.societyId ?? null);
      if (!flatIds.includes(payment.bill.flatId)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else if (req.user!.role !== 'SUPER_ADMIN' && isAdmin) {
      if (payment.bill.flat.block.societyId !== req.user!.societyId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const receiptPayload = {
      id: payment.id,
      amount: payment.amount,
      method: payment.method,
      status: payment.status,
      transactionId: payment.transactionId,
      merchantTransId: payment.merchantTransId,
      gatewayRefId: payment.gatewayRefId,
      receiptNo: payment.receiptNo,
      paidAt: payment.paidAt,
      createdAt: payment.createdAt,
      bill: {
        month: payment.bill.month,
        year: payment.bill.year,
        baseAmount: payment.bill.baseAmount,
        waterCharge: payment.bill.waterCharge,
        parkingCharge: payment.bill.parkingCharge,
        sinkingFund: payment.bill.sinkingFund,
        repairFund: payment.bill.repairFund,
        otherCharges: payment.bill.otherCharges,
        lateFee: payment.bill.lateFee,
        totalAmount: payment.bill.totalAmount,
        paidAmount: payment.bill.paidAmount,
        status: payment.bill.status,
        flat: {
          flatNumber: payment.bill.flat.flatNumber,
          block: {
            name: payment.bill.flat.block.name,
            society: { name: payment.bill.flat.block.society.name },
          },
        },
      },
    };

    if (req.query.download === '1') {
      const fileName = `receipt-${payment.bill.flat.flatNumber}-${payment.bill.month}-${payment.bill.year}.txt`;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(buildReceiptText({ ...payment, bill: receiptPayload.bill }));
    }

    return res.json(receiptPayload);
  } catch (error) {
    logger.error('Payment receipt detail error:', error);
    return res.status(500).json({ error: 'Failed to fetch payment receipt' });
  }
});

// ── PAYMENT REPORT (ADMIN + CSV export) ─────────────────
// Restricted to financial roles. Returns online (PhonePe) payments for reconciliation.
// ?export=csv streams a CSV download.
router.get(
  '/report',
  authenticate,
  authorize('SUPER_ADMIN', ...FINANCIAL_ROLES),
  paymentReportValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const isCsvExport = req.query.export === 'csv';
      const page = (req.query.page as any) || 1;
      const limit = Math.min((req.query.limit as any) || (isCsvExport ? 5000 : 50), isCsvExport ? 5000 : 500);
      const skip = isCsvExport ? 0 : (page - 1) * limit;

      const statusFilter = req.query.status as string | undefined;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const ownerView = req.query.ownerView === 'true';

      // Scope to society
      let societyId: string;
      if (req.user!.role === 'SUPER_ADMIN') {
        const sid = req.query.societyId as string | undefined;
        if (!sid) return res.status(400).json({ error: 'societyId query parameter is required for SUPER_ADMIN' });
        societyId = sid;
      } else {
        if (!req.user!.societyId) return res.status(400).json({ error: 'No society associated with your account' });
        societyId = req.user!.societyId;
      }

      const where: Prisma.PaymentWhereInput = {
        method: 'PHONEPE',
        bill: { flat: { block: { societyId } } },
      };

      if (ownerView && req.user!.role !== 'SUPER_ADMIN') {
        const flatIds = await getUserOwnedFlatIds(req.user!.id, req.user!.societyId ?? null);
        if (flatIds.length === 0) {
          return res.json({ payments: [], total: 0, page, limit, pages: 0 });
        }
        where.bill = { flatId: { in: flatIds } };
      }

      if (statusFilter) where.status = statusFilter as any;
      if (startDate || endDate) {
        where.createdAt = {
          ...(startDate ? { gte: new Date(startDate) } : {}),
          ...(endDate ? { lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)) } : {}),
        };
      }

      const payments = await prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          billId: true,
          amount: true,
          status: true,
          transactionId: true,
          merchantTransId: true,
          gatewayRefId: true,
          paidAt: true,
          createdAt: true,
          bill: {
            select: {
              month: true,
              year: true,
              totalAmount: true,
              flat: {
                select: {
                  flatNumber: true,
                  block: {
                    select: {
                      name: true,
                      society: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (isCsvExport) {
        const MONTH_NAMES_REPORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const csvHeader = 'Date,Society,Block,Flat,Month,Year,Amount (₹),Merchant Txn ID,PhonePe Txn ID,Gateway Ref ID,Status\n';
        const csvRows = payments.map((p) => {
          const date = p.paidAt ? new Date(p.paidAt).toLocaleDateString('en-IN') : new Date(p.createdAt).toLocaleDateString('en-IN');
          const society = p.bill.flat.block.society.name.replace(/,/g, ' ');
          const block = p.bill.flat.block.name.replace(/,/g, ' ');
          const flat = p.bill.flat.flatNumber.replace(/,/g, ' ');
          const month = p.bill.month ? MONTH_NAMES_REPORT[p.bill.month - 1] : 'Custom';
          const year = p.bill.year ?? '';
          return `${date},${society},${block},${flat},${month},${year},${p.amount.toFixed(2)},${p.merchantTransId ?? ''},${p.transactionId ?? ''},${p.gatewayRefId ?? ''},${p.status}`;
        }).join('\n');

        const today = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="payments-report-${today}.csv"`);
        return res.send(csvHeader + csvRows);
      }

      const total = await prisma.payment.count({ where });
      return res.json({ payments, total, page, limit, pages: Math.ceil(total / limit) });
    } catch (error) {
      logger.error('Payment report error:', error);
      return res.status(500).json({ error: 'Failed to fetch payment report' });
    }
  },
);

// ── HELPER: Generate PhonePe Checksum ───────────────────
// (moved to top of file as shared helper)

export default router;
