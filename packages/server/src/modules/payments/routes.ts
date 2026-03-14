import { Router } from 'express';
import { body, param } from 'express-validator';
import crypto from 'crypto';
import { config } from '../../config';
import prisma from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import logger from '../../config/logger';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Helper: get PhonePe config from DB for a society, fallback to env
async function getPhonePeConfig(societyId: string | null) {
  if (societyId) {
    const dbConfig = await prisma.paymentGatewayConfig.findUnique({
      where: { societyId_gateway: { societyId, gateway: 'PHONEPE' } },
    });
    if (dbConfig && dbConfig.isActive) {
      return {
        merchantId: dbConfig.merchantId,
        saltKey: dbConfig.saltKey,
        saltIndex: dbConfig.saltIndex,
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
    saltKey: config.phonepe.saltKey,
    saltIndex: config.phonepe.saltIndex,
    baseUrl: config.phonepe.baseUrl,
    redirectUrl: config.phonepe.redirectUrl,
    callbackUrl: config.phonepe.callbackUrl,
    source: 'environment' as const,
  };
}

// Helper: Generate PhonePe Checksum
function generateChecksum(payload: string, endpoint: string, saltKey: string, saltIndex: number): string {
  const data = payload + endpoint + saltKey;
  const sha256 = crypto.createHash('sha256').update(data).digest('hex');
  return `${sha256}###${saltIndex}`;
}

// ── INITIATE PHONEPE PAYMENT ────────────────────────────
router.post(
  '/phonepe/initiate',
  authenticate,
  [body('billId').isUUID()],
  validate,
  async (req: AuthRequest, res) => {
    try {
      const bill = await prisma.maintenanceBill.findUnique({
        where: { id: req.body.billId },
        include: { flat: { include: { owner: true, block: true } } },
      });

      if (!bill) return res.status(404).json({ error: 'Bill not found' });
      if (bill.status === 'PAID') return res.status(400).json({ error: 'Bill already paid' });

      const amountToPay = bill.totalAmount - bill.paidAmount;
      const merchantTransId = `MT${Date.now()}${uuidv4().slice(0, 8).toUpperCase()}`;

      // Get PhonePe config from DB or env
      const pgConfig = await getPhonePeConfig(req.user!.societyId ?? null);
      if (!pgConfig.merchantId || !pgConfig.saltKey) {
        return res.status(400).json({ error: 'PhonePe is not configured. Ask your admin to set up payment gateway.' });
      }

      // Create payment record
      const payment = await prisma.payment.create({
        data: {
          billId: bill.id,
          amount: amountToPay,
          method: 'PHONEPE',
          status: 'INITIATED',
          merchantTransId,
        },
      });

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

      const phonePeData = await phonePeResponse.json();

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

// ── PHONEPE CALLBACK (Server-to-Server) ─────────────────
router.post('/phonepe/callback', async (req, res) => {
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

    // SECURITY: Verify checksum with the society's PhonePe config
    const societyId = payment.bill?.flat?.block?.societyId;
    const pgConfig = await getPhonePeConfig(societyId ?? null);
    const expectedChecksum = generateChecksum(response, '/pg/v1/pay', pgConfig.saltKey, pgConfig.saltIndex);
    if (receivedChecksum && expectedChecksum !== receivedChecksum) {
      logger.error('PhonePe callback checksum mismatch', { merchantTransId, expected: expectedChecksum, received: receivedChecksum });
      return res.status(400).json({ error: 'Checksum verification failed' });
    }

    const txnStatus = decodedResponse.code;

    if (txnStatus === 'PAYMENT_SUCCESS') {
      // Update payment
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCESS',
          transactionId: decodedResponse.data?.transactionId,
          phonepeResponse: JSON.stringify(decodedResponse),
          paidAt: new Date(),
        },
      });

      // Update bill
      const newPaidAmount = payment.bill.paidAmount + payment.amount;
      const newStatus = newPaidAmount >= payment.bill.totalAmount ? 'PAID' : 'PARTIAL';

      await prisma.maintenanceBill.update({
        where: { id: payment.bill.id },
        data: { paidAmount: newPaidAmount, status: newStatus },
      });

      logger.info(`Payment successful: ${merchantTransId}`);
    } else {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          phonepeResponse: JSON.stringify(decodedResponse),
        },
      });

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

      // If still INITIATED, check with PhonePe
      if (payment.status === 'INITIATED') {
        // Determine societyId from bill's flat block
        const societyId = payment.bill?.flat?.block?.societyId || req.user!.societyId;
        const pgConfig = await getPhonePeConfig(societyId ?? null);

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

          const statusData = await statusResponse.json();

          if (statusData.code === 'PAYMENT_SUCCESS') {
            await prisma.payment.update({
              where: { id: payment.id },
              data: {
                status: 'SUCCESS',
                transactionId: statusData.data?.transactionId,
                phonepeResponse: JSON.stringify(statusData),
                paidAt: new Date(),
              },
            });

            const newPaidAmount = payment.bill.paidAmount + payment.amount;
            await prisma.maintenanceBill.update({
              where: { id: payment.bill.id },
              data: {
                paidAmount: newPaidAmount,
                status: newPaidAmount >= payment.bill.totalAmount ? 'PAID' : 'PARTIAL',
              },
            });

            return res.json({ ...payment, status: 'SUCCESS' });
          }
        } catch (e) {
          logger.warn('Status check to PhonePe failed:', e);
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
