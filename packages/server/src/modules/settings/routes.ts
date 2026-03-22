import { Router, Response } from 'express';
import { body, param } from 'express-validator';
import crypto from 'crypto';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest, SOCIETY_ADMINS } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import logger from '../../config/logger';

const router = Router();
router.use(authenticate);
router.use(authorize('SUPER_ADMIN', ...SOCIETY_ADMINS));

function getRequestOrigin(req: AuthRequest) {
  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
  const protocol = forwardedProto || req.protocol;
  const host = forwardedHost || req.get('host');

  return host ? `${protocol}://${host}` : '';
}

function getDefaultRedirectUrl() {
  return `${process.env.CLIENT_URL || 'http://localhost:5173'}/billing?payment=done`;
}

// ── GET PHONEPE CONFIG ──────────────────────────────────
router.get('/payment-gateway', async (req: AuthRequest, res: Response) => {
  try {
    const societyId = req.user!.role === 'SUPER_ADMIN'
      ? (req.query.societyId as string) || req.user!.societyId
      : req.user!.societyId;
    if (!societyId) return res.status(400).json({ error: 'Society ID required' });

    const config = await prisma.paymentGatewayConfig.findUnique({
      where: { societyId_gateway: { societyId, gateway: 'PHONEPE' } },
    });

    if (!config) {
      const requestOrigin = getRequestOrigin(req);

      return res.json({
        exists: false,
        config: {
          gateway: 'PHONEPE',
          merchantId: '',
          saltKey: '',
          saltIndex: 1,
          environment: 'UAT',
          baseUrl: 'https://api-preprod.phonepe.com/apis/pg-sandbox',
          redirectUrl: getDefaultRedirectUrl(),
          callbackUrl: requestOrigin ? `${requestOrigin}/api/payments/phonepe/callback` : '',
          isActive: false,
        },
      });
    }

    // Mask the salt key for display (show only last 4 chars)
    const masked = {
      ...config,
      saltKey: config.saltKey ? `${'•'.repeat(Math.max(0, config.saltKey.length - 4))}${config.saltKey.slice(-4)}` : '',
      saltKeySet: !!config.saltKey,
    };

    return res.json({ exists: true, config: masked });
  } catch (error) {
    logger.error('Failed to fetch payment config:', error);
    return res.status(500).json({ error: 'Failed to fetch payment gateway config' });
  }
});

// ── CREATE/UPDATE PHONEPE CONFIG ────────────────────────
router.post(
  '/payment-gateway',
  [
    body('merchantId').isString().notEmpty().withMessage('Merchant ID is required'),
    body('saltKey').optional({ values: 'falsy' }).isString(),
    body('saltIndex').optional().isInt({ min: 1 }),
    body('environment').isIn(['UAT', 'PRODUCTION']).withMessage('Environment must be UAT or PRODUCTION'),
    body('redirectUrl').optional({ values: 'falsy' }).isURL({ require_tld: false }),
    body('callbackUrl').optional({ values: 'falsy' }).isURL({ require_tld: false }),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.role === 'SUPER_ADMIN'
        ? req.body.societyId || req.user!.societyId
        : req.user!.societyId;
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const { merchantId, saltKey, saltIndex, environment, redirectUrl, callbackUrl } = req.body;
      const requestOrigin = getRequestOrigin(req);

      const existing = await prisma.paymentGatewayConfig.findUnique({
        where: { societyId_gateway: { societyId, gateway: 'PHONEPE' } },
      });

      // Salt key must be provided on first-time setup, but can be omitted on updates.
      if (!existing && !saltKey) {
        return res.status(400).json({ error: 'Salt Key is required' });
      }

      // Determine base URL from environment
      const baseUrl =
        environment === 'PRODUCTION'
          ? 'https://api.phonepe.com/apis/hermes'
          : 'https://api-preprod.phonepe.com/apis/pg-sandbox';

      const resolvedCallbackUrl = callbackUrl || (requestOrigin ? `${requestOrigin}/api/payments/phonepe/callback` : '');
      const resolvedSaltKey = saltKey || existing?.saltKey || '';

      const config = await prisma.paymentGatewayConfig.upsert({
        where: { societyId_gateway: { societyId, gateway: 'PHONEPE' } },
        update: {
          gateway: 'PHONEPE',
          merchantId,
          saltKey: resolvedSaltKey,
          saltIndex: saltIndex || 1,
          environment,
          baseUrl,
          redirectUrl: redirectUrl || getDefaultRedirectUrl(),
          callbackUrl: resolvedCallbackUrl,
          isActive: true,
        },
        create: {
          societyId,
          gateway: 'PHONEPE',
          merchantId,
          saltKey: resolvedSaltKey,
          saltIndex: saltIndex || 1,
          environment,
          baseUrl,
          redirectUrl: redirectUrl || getDefaultRedirectUrl(),
          callbackUrl: resolvedCallbackUrl,
          isActive: true,
        },
      });

      logger.info(`PhonePe config updated for society ${societyId}`, {
        callbackUrl: config.callbackUrl,
        saltKeyUpdated: !!saltKey,
      });

      return res.json({
        message: 'Payment gateway configuration saved successfully',
        config: {
          ...config,
          saltKey: `${'•'.repeat(Math.max(0, config.saltKey.length - 4))}${config.saltKey.slice(-4)}`,
          saltKeySet: !!config.saltKey,
        },
      });
    } catch (error) {
      logger.error('Failed to save payment config:', error);
      return res.status(500).json({ error: 'Failed to save payment gateway config' });
    }
  },
);

// ── TOGGLE ACTIVE ───────────────────────────────────────
router.patch('/payment-gateway/toggle', async (req: AuthRequest, res: Response) => {
  try {
    const societyId = req.user!.role === 'SUPER_ADMIN'
      ? req.body.societyId || req.user!.societyId
      : req.user!.societyId;
    if (!societyId) return res.status(400).json({ error: 'Society ID required' });

    const existing = await prisma.paymentGatewayConfig.findUnique({
      where: { societyId_gateway: { societyId, gateway: 'PHONEPE' } },
    });

    if (!existing) return res.status(404).json({ error: 'No config found. Please configure first.' });

    const updated = await prisma.paymentGatewayConfig.update({
      where: { id: existing.id },
      data: { isActive: !existing.isActive },
    });

    return res.json({ message: `PhonePe ${updated.isActive ? 'enabled' : 'disabled'}`, isActive: updated.isActive });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to toggle payment gateway' });
  }
});

// ── TEST PHONEPE CONNECTION ─────────────────────────────
router.post('/payment-gateway/test', async (req: AuthRequest, res: Response) => {
  try {
    const societyId = req.user!.role === 'SUPER_ADMIN'
      ? req.body.societyId || req.user!.societyId
      : req.user!.societyId;
    if (!societyId) return res.status(400).json({ error: 'Society ID required' });

    const pgConfig = await prisma.paymentGatewayConfig.findUnique({
      where: { societyId_gateway: { societyId, gateway: 'PHONEPE' } },
    });

    if (!pgConfig) {
      return res.status(404).json({ error: 'No config found. Please save configuration first.' });
    }

    // Build a test payload - use PhonePe's status check API which validates credentials
    // We check status of a non-existent transaction which proves the credentials are valid
    // if we get a proper response (even "TRANSACTION_NOT_FOUND") vs auth error
    const testMerchantTransId = `TEST_${Date.now()}`;
    const endpoint = `/pg/v1/status/${pgConfig.merchantId}/${testMerchantTransId}`;
    const data = '' + endpoint + pgConfig.saltKey;
    const sha256 = crypto.createHash('sha256').update(data).digest('hex');
    const checksum = `${sha256}###${pgConfig.saltIndex}`;

    const startTime = Date.now();

    const response = await fetch(`${pgConfig.baseUrl}${endpoint}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': checksum,
        'X-MERCHANT-ID': pgConfig.merchantId,
      },
    });

    const responseTime = Date.now() - startTime;
    const responseData = await response.json() as { code?: string; message?: string };

    // Determine test result
    // PhonePe returns specific codes:
    //   - BAD_REQUEST / TRANSACTION_NOT_FOUND = credentials valid (just no txn)
    //   - AUTHORIZATION_FAILED = invalid credentials
    //   - INVALID_MERCHANT_ID = wrong merchant ID
    const code = responseData.code || '';
    const isCredentialsValid =
      code === 'TRANSACTION_NOT_FOUND' ||
      code === 'BAD_REQUEST' ||
      code === 'PAYMENT_PENDING' ||
      response.status === 200 ||
      (response.status === 400 && !code.includes('AUTHORIZATION'));

    const isAuthError =
      code === 'AUTHORIZATION_FAILED' ||
      code === 'INVALID_MERCHANT_ID' ||
      response.status === 401 ||
      response.status === 403;

    // Update test results in DB
    await prisma.paymentGatewayConfig.update({
      where: { id: pgConfig.id },
      data: { lastTestedAt: new Date(), lastTestOk: isCredentialsValid },
    });

    if (isAuthError) {
      return res.json({
        success: false,
        message: 'Authentication failed. Please check your Merchant ID and Salt Key.',
        details: {
          code,
          httpStatus: response.status,
          responseTime: `${responseTime}ms`,
          phonePeMessage: responseData.message || '',
        },
      });
    }

    return res.json({
      success: isCredentialsValid,
      message: isCredentialsValid
        ? 'Connection successful! PhonePe credentials are valid.'
        : `Unexpected response from PhonePe (${code})`,
      details: {
        code,
        httpStatus: response.status,
        responseTime: `${responseTime}ms`,
        environment: pgConfig.environment,
        baseUrl: pgConfig.baseUrl,
        phonePeMessage: responseData.message || '',
      },
    });
  } catch (error: any) {
    logger.error('PhonePe test failed:', error);

    // Network errors
    if (error.cause?.code === 'ENOTFOUND' || error.cause?.code === 'ECONNREFUSED') {
      return res.json({
        success: false,
        message: 'Cannot reach PhonePe servers. Check your internet connection and base URL.',
        details: { error: error.message },
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Test failed due to an unexpected error',
      details: { error: error.message },
    });
  }
});

export default router;
