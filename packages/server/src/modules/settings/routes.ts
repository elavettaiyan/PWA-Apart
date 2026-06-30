import { Router, Response } from 'express';
import crypto from 'crypto';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest, SOCIETY_ADMINS, invalidateAuthCache } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import logger from '../../config/logger';
import { runMemberRemoval } from '../members/removal';
import runLateFeeWorker from '../../jobs/lateFeeWorker';
import { resolveSettingsSocietyId } from './permissions';
import {
  ConfigurableMenuRole,
  getCommitteeMemberLimit,
  getDefaultMenuIdsForRole,
  getDefaultRedirectUrl,
  getPhonePeAuthBaseUrl,
  getPhonePeBaseUrl,
  getRequestOrigin,
  getRoleLimit,
  getRoleMenuConfigResponse,
  hasActiveOwnerRecord,
  maskPaymentGatewayConfig,
  normalizeAdminAssignmentType,
  normalizeVisibleMenuIds,
  syncUserPrimaryMembershipRole,
  TRANSFERABLE_ADMIN_ASSIGNMENT_TYPES,
} from './service';
import {
  communityProfileValidation,
  memberRoleValidation,
  memberUserIdValidation,
  menuVisibilityValidation,
  paymentGatewayValidation,
  removeMemberValidation,
  runLateFeesValidation,
  societySettingsValidation,
} from './validation';

const router = Router();
router.use(authenticate);

router.get('/menu-visibility', async (req: AuthRequest, res: Response) => {
  try {
    const societyId = resolveSettingsSocietyId(req, req.query.societyId as string | undefined);
    if (!societyId) return res.status(400).json({ error: 'Society ID required' });

    return res.json(await getRoleMenuConfigResponse(societyId));
  } catch (error) {
    logger.error('Failed to fetch menu visibility config:', error);
    return res.status(500).json({ error: 'Failed to fetch menu visibility config' });
  }
});

router.use(authorize('SUPER_ADMIN', ...SOCIETY_ADMINS));

router.put(
  '/menu-visibility/:role',
  menuVisibilityValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const role = req.params.role as ConfigurableMenuRole;
      const societyId = resolveSettingsSocietyId(req, req.body.societyId);
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const visibleMenuIds = normalizeVisibleMenuIds(role, req.body.visibleMenuIds);
      const defaultMenuIds = getDefaultMenuIdsForRole(role);
      const isDefaultConfig =
        visibleMenuIds.length === defaultMenuIds.length &&
        visibleMenuIds.every((menuId, index) => menuId === defaultMenuIds[index]);

      if (isDefaultConfig) {
        await prisma.societyRoleMenuConfig.deleteMany({ where: { societyId, role } });
      } else {
        await prisma.societyRoleMenuConfig.upsert({
          where: { societyId_role: { societyId, role } },
          update: { visibleMenuIds: JSON.stringify(visibleMenuIds) },
          create: { societyId, role, visibleMenuIds: JSON.stringify(visibleMenuIds) },
        });
      }

      logger.info('Updated menu visibility config', {
        updatedBy: req.user?.id,
        societyId,
        role,
        visibleMenuIds,
      });

      const response = await getRoleMenuConfigResponse(societyId);
      return res.json({
        message: 'Menu visibility updated successfully',
        ...response,
      });
    } catch (error) {
      logger.error('Failed to update menu visibility config:', error);
      return res.status(500).json({ error: 'Failed to update menu visibility config' });
    }
  },
);

function getPaymentGatewaySocietyId(req: AuthRequest, candidate?: string) {
  return req.user!.role === 'SUPER_ADMIN'
    ? candidate || req.user!.societyId
    : req.user!.societyId;
}

function buildDefaultGatewayConfigs(requestOrigin: string) {
  return {
    PHONEPE: {
      gateway: 'PHONEPE',
      merchantId: '',
      clientId: '',
      clientSecret: '',
      clientVersion: 1,
      keyId: '',
      keySecret: '',
      webhookSecret: '',
      saltKey: '',
      saltIndex: 1,
      environment: 'UAT',
      baseUrl: getPhonePeBaseUrl('UAT'),
      redirectUrl: getDefaultRedirectUrl(),
      callbackUrl: requestOrigin ? `${requestOrigin}/api/payments/phonepe/callback` : '',
      isActive: false,
      exists: false,
    },
    RAZORPAY: {
      gateway: 'RAZORPAY',
      merchantId: '',
      clientId: '',
      clientSecret: '',
      clientVersion: 1,
      keyId: '',
      keySecret: '',
      webhookSecret: '',
      saltKey: '',
      saltIndex: 1,
      environment: 'PRODUCTION',
      baseUrl: 'https://api.razorpay.com/v1',
      redirectUrl: getDefaultRedirectUrl(),
      callbackUrl: requestOrigin ? `${requestOrigin}/api/payments/razorpay/webhook` : '',
      isActive: false,
      exists: false,
    },
  };
}

router.get('/payment-gateway', async (req: AuthRequest, res: Response) => {
  try {
    const societyId = getPaymentGatewaySocietyId(req, req.query.societyId as string | undefined);
    if (!societyId) return res.status(400).json({ error: 'Society ID required' });

    const requestOrigin = getRequestOrigin(req);
    const defaults = buildDefaultGatewayConfigs(requestOrigin);
    const configs = await prisma.paymentGatewayConfig.findMany({
      where: { societyId },
      orderBy: { gateway: 'asc' },
    });

    for (const gatewayConfig of configs) {
      defaults[gatewayConfig.gateway] = {
        ...defaults[gatewayConfig.gateway],
        ...maskPaymentGatewayConfig(gatewayConfig),
        merchantId: gatewayConfig.gateway === 'RAZORPAY' && gatewayConfig.merchantId === 'maintenance'
          ? ''
          : gatewayConfig.merchantId,
        exists: true,
      };
    }

    const activeGateway = configs.find((item) => item.isActive)?.gateway ?? null;

    return res.json({
      exists: configs.length > 0,
      activeGateway,
      configs: defaults,
      config: activeGateway ? defaults[activeGateway] : defaults.PHONEPE,
    });
  } catch (error) {
    logger.error('Failed to fetch payment config:', error);
    return res.status(500).json({ error: 'Failed to fetch payment gateway config' });
  }
});

router.post(
  '/payment-gateway',
  paymentGatewayValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = getPaymentGatewaySocietyId(req, req.body.societyId);
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const {
        gateway,
        merchantId,
        clientId,
        clientSecret,
        clientVersion,
        keyId,
        keySecret,
        webhookSecret,
        saltKey,
        saltIndex,
        environment,
        redirectUrl,
        callbackUrl,
        isActive,
      } = req.body;
      const requestOrigin = getRequestOrigin(req);

      const existing = await prisma.paymentGatewayConfig.findUnique({
        where: { societyId_gateway: { societyId, gateway } },
      });

      const normalizedClientId = typeof clientId === 'string' ? clientId.trim() : '';
      const normalizedClientSecret = typeof clientSecret === 'string' ? clientSecret.trim() : '';
      const normalizedMerchantId = typeof merchantId === 'string' ? merchantId.trim() : '';
      const normalizedKeyId = typeof keyId === 'string' ? keyId.trim() : '';
      const normalizedKeySecret = typeof keySecret === 'string' ? keySecret.trim() : '';
      const normalizedWebhookSecret = typeof webhookSecret === 'string' ? webhookSecret.trim() : '';

      if (gateway === 'PHONEPE' && !normalizedMerchantId) {
        return res.status(400).json({ error: 'Merchant ID is required' });
      }

      if (gateway === 'PHONEPE' && ((normalizedClientId && !normalizedClientSecret && !existing?.clientSecret) || (!normalizedClientId && normalizedClientSecret))) {
        return res.status(400).json({ error: 'Client ID and Client Secret must be provided together' });
      }

      if (gateway === 'RAZORPAY') {
        if (!normalizedKeyId && !existing?.keyId) {
          return res.status(400).json({ error: 'Razorpay Key ID is required' });
        }

        if (!normalizedKeySecret && !existing?.keySecret) {
          return res.status(400).json({ error: 'Razorpay Key Secret is required' });
        }

        if ((normalizedKeyId && !normalizedKeySecret && !existing?.keySecret) || (!normalizedKeyId && normalizedKeySecret)) {
          return res.status(400).json({ error: 'Razorpay Key ID and Key Secret must be provided together' });
        }
      }

      const resolvedCallbackUrl = callbackUrl || (requestOrigin
        ? gateway === 'PHONEPE'
          ? `${requestOrigin}/api/payments/phonepe/callback`
          : `${requestOrigin}/api/payments/razorpay/webhook`
        : '');

      const resolvedConfig = await prisma.$transaction(async (tx) => {
        const desiredActive = isActive !== false;

        if (desiredActive) {
          await tx.paymentGatewayConfig.updateMany({
            where: { societyId, gateway: { not: gateway } },
            data: { isActive: false },
          });
        }

        return tx.paymentGatewayConfig.upsert({
          where: { societyId_gateway: { societyId, gateway } },
          update: {
            gateway,
            merchantId: normalizedMerchantId,
            clientId: normalizedClientId || existing?.clientId || null,
            clientSecret: normalizedClientSecret || existing?.clientSecret || null,
            clientVersion: Number(clientVersion) > 0 ? Number(clientVersion) : existing?.clientVersion || 1,
            keyId: normalizedKeyId || existing?.keyId || null,
            keySecret: normalizedKeySecret || existing?.keySecret || null,
            webhookSecret: normalizedWebhookSecret || existing?.webhookSecret || null,
            saltKey: saltKey || existing?.saltKey || '',
            saltIndex: saltIndex || existing?.saltIndex || 1,
            environment,
            baseUrl: gateway === 'PHONEPE' ? getPhonePeBaseUrl(environment) : 'https://api.razorpay.com/v1',
            redirectUrl: redirectUrl || existing?.redirectUrl || getDefaultRedirectUrl(),
            callbackUrl: resolvedCallbackUrl,
            isActive: desiredActive,
          },
          create: {
            societyId,
            gateway,
            merchantId: normalizedMerchantId,
            clientId: normalizedClientId || null,
            clientSecret: normalizedClientSecret || null,
            clientVersion: Number(clientVersion) > 0 ? Number(clientVersion) : 1,
            keyId: normalizedKeyId || null,
            keySecret: normalizedKeySecret || null,
            webhookSecret: normalizedWebhookSecret || null,
            saltKey: saltKey || '',
            saltIndex: saltIndex || 1,
            environment,
            baseUrl: gateway === 'PHONEPE' ? getPhonePeBaseUrl(environment) : 'https://api.razorpay.com/v1',
            redirectUrl: redirectUrl || getDefaultRedirectUrl(),
            callbackUrl: resolvedCallbackUrl,
            isActive: isActive !== false,
          },
        });
      });

      logger.info(`Payment gateway config updated for society ${societyId}`, {
        gateway,
        callbackUrl: resolvedConfig.callbackUrl,
      });

      return res.json({
        message: 'Payment gateway configuration saved successfully',
        activeGateway: resolvedConfig.isActive ? resolvedConfig.gateway : null,
        config: maskPaymentGatewayConfig(resolvedConfig),
      });
    } catch (error) {
      logger.error('Failed to save payment config:', error);
      return res.status(500).json({ error: 'Failed to save payment gateway config' });
    }
  },
);

router.patch('/payment-gateway/toggle', async (req: AuthRequest, res: Response) => {
  try {
    const societyId = getPaymentGatewaySocietyId(req, req.body.societyId);
    if (!societyId) return res.status(400).json({ error: 'Society ID required' });

    const gateway = req.body.gateway;
    if (gateway !== 'PHONEPE' && gateway !== 'RAZORPAY') {
      return res.status(400).json({ error: 'Gateway must be PHONEPE or RAZORPAY' });
    }

    const existing = await prisma.paymentGatewayConfig.findUnique({
      where: { societyId_gateway: { societyId, gateway } },
    });

    if (!existing) return res.status(404).json({ error: 'No config found. Please configure first.' });

    const targetState = !existing.isActive;
    const updated = await prisma.$transaction(async (tx) => {
      if (targetState) {
        await tx.paymentGatewayConfig.updateMany({
          where: { societyId, gateway: { not: gateway } },
          data: { isActive: false },
        });
      }

      return tx.paymentGatewayConfig.update({
        where: { id: existing.id },
        data: { isActive: targetState },
      });
    });

    return res.json({
      message: `${gateway} ${updated.isActive ? 'enabled' : 'disabled'}`,
      gateway,
      isActive: updated.isActive,
      activeGateway: updated.isActive ? gateway : null,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to toggle payment gateway' });
  }
});

router.post('/payment-gateway/test', async (req: AuthRequest, res: Response) => {
  try {
    const societyId = getPaymentGatewaySocietyId(req, req.body.societyId);
    if (!societyId) return res.status(400).json({ error: 'Society ID required' });

    const gateway = req.body.gateway;
    if (gateway !== 'PHONEPE' && gateway !== 'RAZORPAY') {
      return res.status(400).json({ error: 'Gateway must be PHONEPE or RAZORPAY' });
    }

    const pgConfig = await prisma.paymentGatewayConfig.findUnique({
      where: { societyId_gateway: { societyId, gateway } },
    });

    if (!pgConfig) {
      return res.status(404).json({ error: 'No config found. Please save configuration first.' });
    }

    const startTime = Date.now();

    if (gateway === 'RAZORPAY') {
      if (!pgConfig.keyId || !pgConfig.keySecret) {
        return res.json({
          success: false,
          message: 'Razorpay Key ID and Key Secret are required.',
          details: {
            environment: pgConfig.environment,
            baseUrl: pgConfig.baseUrl,
          },
        });
      }

      const credentials = Buffer.from(`${pgConfig.keyId}:${pgConfig.keySecret}`).toString('base64');
      const response = await fetch(`${pgConfig.baseUrl}/orders?count=1`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${credentials}`,
        },
      });

      const responseTime = Date.now() - startTime;
      const responseData = await response.json() as { error?: { description?: string } };
      const isCredentialsValid = response.ok;

      await prisma.paymentGatewayConfig.update({
        where: { id: pgConfig.id },
        data: { lastTestedAt: new Date(), lastTestOk: isCredentialsValid },
      });

      return res.json({
        success: isCredentialsValid,
        message: isCredentialsValid
          ? 'Razorpay credentials are valid.'
          : 'Razorpay authentication failed. Check Key ID and Key Secret.',
        details: {
          httpStatus: response.status,
          responseTime: `${responseTime}ms`,
          environment: pgConfig.environment,
          baseUrl: pgConfig.baseUrl,
          razorpayMessage: responseData.error?.description || '',
        },
      });
    }

    if (pgConfig.clientId && pgConfig.clientSecret) {
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

      const responseTime = Date.now() - startTime;
      const responseData = await response.json() as { access_token?: string; token_type?: string; message?: string; error?: string };
      const isCredentialsValid = response.ok && !!responseData.access_token;

      await prisma.paymentGatewayConfig.update({
        where: { id: pgConfig.id },
        data: { lastTestedAt: new Date(), lastTestOk: isCredentialsValid },
      });

      return res.json({
        success: isCredentialsValid,
        message: isCredentialsValid
          ? 'SDK auth token generated successfully. Client credentials are valid.'
          : 'SDK auth token generation failed. Check Client ID and Client Secret.',
        details: {
          code: responseData.error || responseData.token_type || '',
          httpStatus: response.status,
          responseTime: `${responseTime}ms`,
          environment: pgConfig.environment,
          baseUrl: getPhonePeAuthBaseUrl(pgConfig.environment),
          phonePeMessage: responseData.message || '',
        },
      });
    }

    if (!pgConfig.merchantId || !pgConfig.saltKey) {
      return res.json({
        success: false,
        message: 'Salt Key is optional for Android SDK, but required when testing legacy web redirect payments.',
        details: {
          environment: pgConfig.environment,
          baseUrl: pgConfig.baseUrl,
        },
      });
    }

    const testMerchantTransId = `TEST_${Date.now()}`;
    const endpoint = `/pg/v1/status/${pgConfig.merchantId}/${testMerchantTransId}`;
    const data = '' + endpoint + pgConfig.saltKey;
    const sha256 = crypto.createHash('sha256').update(data).digest('hex');
    const checksum = `${sha256}###${pgConfig.saltIndex}`;

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
    logger.error('Payment gateway test failed:', error);

    if (error.cause?.code === 'ENOTFOUND' || error.cause?.code === 'ECONNREFUSED') {
      return res.json({
        success: false,
        message: 'Cannot reach payment gateway servers. Check your internet connection and base URL.',
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

// ── LIST SOCIETY MEMBERS WITH ROLES ─────────────────────
router.get('/members', async (req: AuthRequest, res: Response) => {
  try {
    const societyId = req.user!.societyId;
    if (!societyId) return res.status(400).json({ error: 'Society ID required' });

    const memberships = await prisma.userSocietyMembership.findMany({
      where: { societyId, role: { not: 'TENANT' } },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, specialization: true, isActive: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return res.json(
      memberships.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        phone: m.user.phone,
        specialization: m.user.specialization,
        isActive: m.user.isActive,
        role: m.role,
        adminAssignmentType: normalizeAdminAssignmentType(m.role, m.adminAssignmentType),
        membershipId: m.id,
      })),
    );
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// ── CHANGE MEMBER ROLE ──────────────────────────────────
router.patch(
  '/members/:userId/role',
  memberRoleValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.societyId;
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const { userId } = req.params;
      const { role: newRole } = req.body;

      // Cannot change your own role
      if (userId === req.user!.id) {
        return res.status(400).json({ error: 'You cannot change your own role' });
      }

      // Verify target user belongs to this society
      const membership = await prisma.userSocietyMembership.findUnique({
        where: { userId_societyId: { userId, societyId } },
      });
      if (!membership) return res.status(404).json({ error: 'Member not found in this society' });

      if (membership.role === 'ADMIN') {
        return res.status(400).json({ error: 'Use Transfer President to change the current admin role' });
      }

      // Enforce role limits (only when assigning TO a limited role)
      const limit = newRole === 'COMMITTEE_MEMBER' ? await getCommitteeMemberLimit(societyId) : getRoleLimit(newRole);
      if (limit) {
        const currentCount = await prisma.userSocietyMembership.count({
          where: { societyId, role: newRole as any },
        });
        if (currentCount >= limit) {
          const roleName = newRole.replace(/_/g, ' ').toLowerCase();
          return res.status(400).json({
            error: `Only ${limit} ${roleName}${limit > 1 ? 's' : ''} allowed per society. Remove the existing one first.`,
          });
        }
      }

      // Update the membership role
      await prisma.userSocietyMembership.update({
        where: { userId_societyId: { userId, societyId } },
        data: { role: newRole, adminAssignmentType: null, adminAssignedAt: null },
      });

      await syncUserPrimaryMembershipRole(prisma, userId);

      // Evict cached auth data so the new role takes effect immediately
      invalidateAuthCache(userId);

      logger.info('Member role changed', {
        changedBy: req.user!.id,
        targetUser: userId,
        oldRole: membership.role,
        newRole,
        societyId,
      });

      return res.json({ message: 'Role updated successfully' });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update role' });
    }
  },
);

router.post(
  '/members/:userId/transfer-president',
  memberUserIdValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.societyId;
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const targetUserId = req.params.userId;
      if (targetUserId === req.user!.id) {
        return res.status(400).json({ error: 'Transfer target must be another owner' });
      }

      const [actorMembership, targetMembership, adminMembershipCount] = await Promise.all([
        prisma.userSocietyMembership.findUnique({
          where: { userId_societyId: { userId: req.user!.id, societyId } },
          select: { role: true, adminAssignmentType: true },
        }),
        prisma.userSocietyMembership.findUnique({
          where: { userId_societyId: { userId: targetUserId, societyId } },
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        }),
        prisma.userSocietyMembership.count({
          where: { societyId, role: 'ADMIN' },
        }),
      ]);

      if (!actorMembership || actorMembership.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Only the current President or Temporary Admin can transfer President access' });
      }

      if (!TRANSFERABLE_ADMIN_ASSIGNMENT_TYPES.has(normalizeAdminAssignmentType(actorMembership.role, actorMembership.adminAssignmentType) || '')) {
        return res.status(403).json({ error: 'Current admin assignment is not eligible for transfer' });
      }

      if (!targetMembership) {
        return res.status(404).json({ error: 'Target member not found in this society' });
      }

      if (targetMembership.role === 'ADMIN') {
        return res.status(400).json({ error: 'Target member is already the President' });
      }

      if (adminMembershipCount !== 1) {
        return res.status(400).json({ error: 'President transfer is blocked until this society has exactly one active admin membership' });
      }

      const [actorHasOwnerRecord, targetHasOwnerRecord] = await Promise.all([
        hasActiveOwnerRecord(prisma, req.user!.id, societyId),
        hasActiveOwnerRecord(prisma, targetUserId, societyId),
      ]);

      if (!actorHasOwnerRecord) {
        return res.status(400).json({ error: 'Transfer is blocked until your account is mapped as an active owner in this community' });
      }

      if (!targetHasOwnerRecord) {
        return res.status(400).json({ error: 'President can only be transferred to an active owner in this community' });
      }

      await prisma.$transaction(async (tx) => {
        await tx.userSocietyMembership.update({
          where: { userId_societyId: { userId: req.user!.id, societyId } },
          data: {
            role: 'OWNER',
            adminAssignmentType: null,
            adminAssignedAt: null,
          },
        });

        await tx.userSocietyMembership.update({
          where: { userId_societyId: { userId: targetUserId, societyId } },
          data: {
            role: 'ADMIN',
            adminAssignmentType: 'PRESIDENT',
            adminAssignedAt: new Date(),
          },
        });

        await Promise.all([
          syncUserPrimaryMembershipRole(tx, req.user!.id),
          syncUserPrimaryMembershipRole(tx, targetUserId),
        ]);
      });

      invalidateAuthCache(req.user!.id);
      invalidateAuthCache(targetUserId);

      logger.info('President transferred', {
        transferredBy: req.user!.id,
        targetUserId,
        societyId,
      });

      return res.json({
        message: 'President transferred successfully',
        targetUser: {
          id: targetMembership.user.id,
          name: targetMembership.user.name,
          email: targetMembership.user.email,
        },
      });
    } catch (error: any) {
      logger.error('President transfer failed', {
        requestedBy: req.user?.id,
        targetUserId: req.params.userId,
        societyId: req.user?.societyId,
        error: error.message,
      });
      return res.status(500).json({ error: 'Failed to transfer President role' });
    }
  },
);

router.delete(
  '/members/:userId',
  removeMemberValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.societyId;
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const { userId } = req.params;
      const reason = String(req.body.reason || '').trim();

      if (userId === req.user!.id) {
        return res.status(400).json({ error: 'You cannot remove your own account from this society' });
      }

      const [membership, society] = await Promise.all([
        prisma.userSocietyMembership.findUnique({
          where: { userId_societyId: { userId, societyId } },
          include: {
            user: {
              select: { id: true, name: true, email: true, phone: true, activeSocietyId: true },
            },
          },
        }),
        prisma.society.findUnique({ where: { id: societyId }, select: { name: true } }),
      ]);

      if (!membership) return res.status(404).json({ error: 'Member not found in this society' });
      if (membership.role !== 'OWNER' && membership.role !== 'SERVICE_STAFF') {
        return res.status(400).json({ error: 'Only owners and service staff can be removed from Members & Roles' });
      }

      if (membership.role === 'SERVICE_STAFF') {
        await runMemberRemoval({
          societyId,
          societyName: society?.name || 'your society',
          targetUserId: membership.user.id,
          targetRole: 'SERVICE_STAFF',
          removedByUserId: req.user!.id,
          removedByRole: req.user!.role as any,
          reason,
          source: 'MEMBERS_ROLES',
          recipientEmail: membership.user.email,
          recipientName: membership.user.name,
          snapshot: {
            name: membership.user.name,
            email: membership.user.email,
            phone: membership.user.phone,
          },
          removeData: async () => {},
        });

        logger.info('Service staff removed from society', {
          removedBy: req.user!.id,
          targetUser: userId,
          societyId,
        });

        return res.json({ message: 'Service staff removed successfully' });
      }

      const ownerRecords = await prisma.owner.findMany({
        where: { userId, flat: { block: { societyId } } },
        include: {
          flat: {
            select: {
              id: true,
              flatNumber: true,
              tenant: { select: { id: true, isActive: true } },
              block: { select: { name: true } },
            },
          },
        },
      });

      await runMemberRemoval({
        societyId,
        societyName: society?.name || 'your society',
        targetUserId: membership.user.id,
        targetRole: 'OWNER',
        removedByUserId: req.user!.id,
        removedByRole: req.user!.role as any,
        reason,
        source: 'MEMBERS_ROLES',
        recipientEmail: membership.user.email,
        recipientName: membership.user.name,
        snapshot: {
          name: membership.user.name,
          email: membership.user.email,
          phone: membership.user.phone,
          flats: ownerRecords.map((owner) => ({
            ownerId: owner.id,
            flatId: owner.flat.id,
            flatNumber: owner.flat.flatNumber,
            blockName: owner.flat.block.name,
          })),
        },
        removeData: async (tx) => {
          const ownerIds = ownerRecords.map((owner) => owner.id);
          if (ownerIds.length > 0) {
            await tx.owner.deleteMany({ where: { id: { in: ownerIds } } });
          }

          for (const owner of ownerRecords) {
            await tx.flat.update({
              where: { id: owner.flat.id },
              data: { isOccupied: !!owner.flat.tenant?.isActive },
            });
          }
        },
      });

      logger.info('Owner removed from society members', {
        removedBy: req.user!.id,
        targetUser: userId,
        societyId,
      });

      return res.json({ message: 'Owner removed successfully' });
    } catch (error: any) {
      logger.error('Failed to remove owner member', { error: error.message, userId: req.params.userId });
      return res.status(500).json({ error: 'Failed to remove owner' });
    }
  },
);

// ─── Community Profile ──────────────────────────────────────────────

router.get(
  '/community-profile',
  authenticate,
  authorize(...SOCIETY_ADMINS),
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.societyId!;
      const society = await prisma.society.findUnique({
        where: { id: societyId },
        select: {
          name: true,
          communityType: true,
          address: true,
          city: true,
          state: true,
          pincode: true,
          totalUnits: true,
        },
      });
      if (!society) return res.status(404).json({ error: 'Society not found' });
      return res.json(society);
    } catch (error: any) {
      logger.error('Failed to fetch community profile', { error: error.message });
      return res.status(500).json({ error: 'Failed to fetch community profile' });
    }
  },
);

router.put(
  '/community-profile',
  authenticate,
  authorize(...SOCIETY_ADMINS),
  communityProfileValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = req.user!.societyId!;
      const { name, communityType, address, city, state, pincode, totalUnits } = req.body;

      const data: Record<string, any> = {};
      if (name !== undefined) data.name = name;
      if (communityType !== undefined) data.communityType = communityType;
      if (address !== undefined) data.address = address;
      if (city !== undefined) data.city = city;
      if (state !== undefined) data.state = state;
      if (pincode !== undefined) data.pincode = pincode;
      if (totalUnits !== undefined) data.totalUnits = totalUnits === null ? null : Number(totalUnits);

      if (Object.keys(data).length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      const updated = await prisma.society.update({
        where: { id: societyId },
        data,
        select: {
          name: true,
          communityType: true,
          address: true,
          city: true,
          state: true,
          pincode: true,
          totalUnits: true,
        },
      });

      logger.info('Community profile updated', { societyId, fields: Object.keys(data) });
      return res.json(updated);
    } catch (error: any) {
      logger.error('Failed to update community profile', { error: error.message });
      return res.status(500).json({ error: 'Failed to update community profile' });
    }
  },
);

// ── SOCIETY SETTINGS (FEATURE TOGGLES) ─────────────────────
router.get('/society-settings', async (req: AuthRequest, res: Response) => {
  try {
    const societyId = resolveSettingsSocietyId(req, req.query.societyId as string | undefined);
    if (!societyId) return res.status(400).json({ error: 'Society ID required' });

    let settings = await prisma.societySettings.findUnique({ where: { societyId } });
    if (!settings) {
      // Return defaults if not configured yet
      settings = await prisma.societySettings.create({
        data: {
          societyId,
          lateFeeEnabled: true,
          lateFeeMode: 'PER_DAY',
          recurringLateFeeFrequency: 'MONTHLY',
          gracePeriodDays: 0,
          dueDay: 10,
          committeeMemberLimit: 0,
          partialPaymentAllowed: true,
          advancePaymentAllowed: true,
          autoAdjustAdvance: true,
          supportsPets: false,
          forceOldestDueSettlement: true,
          manualBillSelection: false,
        },
      });
    }

    return res.json({
      ...settings,
      committeeMemberLimit: settings.committeeMemberLimit ?? 0,
      forceOldestDueSettlement: true,
      manualBillSelection: false,
    });
  } catch (error: any) {
    logger.error('Failed to fetch society settings', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch society settings' });
  }
});

router.put(
  '/society-settings',
  societySettingsValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = resolveSettingsSocietyId(req, req.body.societyId);
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const {
        lateFeeEnabled,
        lateFeeMode,
        recurringLateFeeFrequency,
        gracePeriodDays,
        dueDay,
        committeeMemberLimit,
        partialPaymentAllowed,
        advancePaymentAllowed,
        autoAdjustAdvance,
        supportsPets,
        configuredFlatTypes,
      } = req.body;

      const settings = await prisma.societySettings.upsert({
        where: { societyId },
        create: {
          societyId,
          lateFeeEnabled: lateFeeEnabled ?? true,
          lateFeeMode: lateFeeMode ?? 'PER_DAY',
          recurringLateFeeFrequency: recurringLateFeeFrequency ?? 'MONTHLY',
          gracePeriodDays: gracePeriodDays ?? 0,
          dueDay: dueDay ?? 10,
          committeeMemberLimit: committeeMemberLimit ?? 0,
          partialPaymentAllowed: partialPaymentAllowed ?? true,
          advancePaymentAllowed: advancePaymentAllowed ?? true,
          autoAdjustAdvance: autoAdjustAdvance ?? true,
          supportsPets: supportsPets ?? false,
          configuredFlatTypes: Array.isArray(configuredFlatTypes) ? configuredFlatTypes : [],
          forceOldestDueSettlement: true,
          manualBillSelection: false,
        },
        update: {
          ...(lateFeeEnabled !== undefined ? { lateFeeEnabled } : {}),
          ...(lateFeeMode !== undefined ? { lateFeeMode } : {}),
          ...(recurringLateFeeFrequency !== undefined ? { recurringLateFeeFrequency } : {}),
          ...(gracePeriodDays !== undefined ? { gracePeriodDays } : {}),
          ...(dueDay !== undefined ? { dueDay } : {}),
          ...(committeeMemberLimit !== undefined ? { committeeMemberLimit } : {}),
          ...(partialPaymentAllowed !== undefined ? { partialPaymentAllowed } : {}),
          ...(advancePaymentAllowed !== undefined ? { advancePaymentAllowed } : {}),
          ...(autoAdjustAdvance !== undefined ? { autoAdjustAdvance } : {}),
          ...(supportsPets !== undefined ? { supportsPets } : {}),
          ...(configuredFlatTypes !== undefined ? { configuredFlatTypes } : {}),
          forceOldestDueSettlement: true,
          manualBillSelection: false,
        },
      });

      return res.json({ message: 'Settings saved successfully', settings });
    } catch (error: any) {
      logger.error('Failed to save society settings', { error: error.message });
      return res.status(500).json({ error: 'Failed to save society settings' });
    }
  },
);

router.post(
  '/society-settings/run-late-fees',
  runLateFeesValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const societyId = resolveSettingsSocietyId(req, req.body.societyId);
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const result = await runLateFeeWorker(societyId, {
        triggerSource: 'MANUAL',
        triggeredByUserId: req.user?.id || null,
      });
      const run = result.runs[0];

      return res.json({
        message: result.totalUpdated > 0
          ? `Late fee scheduler completed. Updated ${result.totalUpdated} bill${result.totalUpdated === 1 ? '' : 's'}.`
          : 'Late fee scheduler completed. No bills needed a late fee update.',
        updated: result.totalUpdated,
        run,
      });
    } catch (error: any) {
      logger.error('Failed to run manual late fee scheduler', {
        error: error.message,
        societyId: req.body?.societyId,
        requestedBy: req.user?.id,
      });
      return res.status(500).json({ error: 'Failed to run late fee scheduler' });
    }
  },
);

export default router;
