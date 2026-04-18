import { Router, Response } from 'express';
import { body, param } from 'express-validator';
import { Role } from '@prisma/client';
import crypto from 'crypto';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest, SOCIETY_ADMINS, invalidateAuthCache } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import logger from '../../config/logger';
import { runMemberRemoval } from '../members/removal';

const ASSIGNABLE_ROLES = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER', 'OWNER', 'SERVICE_STAFF'] as const;

// Max members allowed per committee role in a society (0 = unlimited)
const ROLE_LIMITS: Partial<Record<string, number>> = {
  ADMIN: 1,
  SECRETARY: 1,
  JOINT_SECRETARY: 2,
  TREASURER: 1,
};

const router = Router();
router.use(authenticate);

const MENU_CATALOG = [
  { id: 'dashboard', label: 'Dashboard', href: '/' },
  { id: 'community', label: 'Community', href: '/community' },
  { id: 'flats', label: 'Flats & Residents', href: '/flats' },
  { id: 'my-flat', label: 'My Flat', href: '/my-flat' },
  { id: 'billing', label: 'Billing', href: '/billing' },
  { id: 'complaints', label: 'Complaints', href: '/complaints' },
  { id: 'gate-management', label: 'Gate Management', href: '/gate-management' },
  { id: 'entry-activity', label: 'Entry Activity', href: '/entry-activity' },
  { id: 'expenses', label: 'Expenses', href: '/expenses' },
  { id: 'assets', label: 'Assets', href: '/assets' },
  { id: 'reports', label: 'Reports', href: '/reports' },
  { id: 'settings', label: 'Settings', href: '/settings' },
] as const;

const CONFIGURABLE_MENU_ROLES = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER', 'OWNER', 'TENANT'] as const;
const ROLE_LABELS: Record<(typeof CONFIGURABLE_MENU_ROLES)[number], string> = {
  ADMIN: 'Admin',
  SECRETARY: 'Secretary',
  JOINT_SECRETARY: 'Joint Secretary',
  TREASURER: 'Treasurer',
  OWNER: 'Owner',
  TENANT: 'Tenant',
};

type MenuId = (typeof MENU_CATALOG)[number]['id'];
type ConfigurableMenuRole = (typeof CONFIGURABLE_MENU_ROLES)[number];

const MENU_ID_SET = new Set<MenuId>(MENU_CATALOG.map((item) => item.id));

const BASELINE_MENU_IDS_BY_ROLE: Record<ConfigurableMenuRole, MenuId[]> = {
  ADMIN: ['dashboard', 'my-flat', 'billing', 'settings'],
  SECRETARY: ['dashboard', 'my-flat', 'billing', 'settings'],
  JOINT_SECRETARY: ['dashboard', 'my-flat', 'billing'],
  TREASURER: ['my-flat', 'billing', 'expenses', 'reports'],
  OWNER: ['my-flat', 'billing'],
  TENANT: ['my-flat', 'billing'],
};

const DEFAULT_MENU_IDS_BY_ROLE: Record<ConfigurableMenuRole, MenuId[]> = {
  ADMIN: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'gate-management', 'entry-activity', 'expenses', 'assets', 'reports', 'settings'],
  SECRETARY: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'entry-activity', 'assets', 'reports', 'settings'],
  JOINT_SECRETARY: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'entry-activity', 'assets'],
  TREASURER: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'entry-activity', 'expenses', 'reports'],
  OWNER: ['dashboard', 'community', 'my-flat', 'billing', 'complaints', 'entry-activity'],
  TENANT: ['dashboard', 'community', 'my-flat', 'billing', 'complaints', 'entry-activity'],
};

const ALLOWED_MENU_IDS_BY_ROLE: Record<ConfigurableMenuRole, MenuId[]> = {
  ADMIN: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'gate-management', 'entry-activity', 'expenses', 'assets', 'reports', 'settings'],
  SECRETARY: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'gate-management', 'entry-activity', 'expenses', 'assets', 'reports', 'settings'],
  JOINT_SECRETARY: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'gate-management', 'entry-activity', 'expenses', 'assets', 'reports'],
  TREASURER: ['dashboard', 'community', 'flats', 'my-flat', 'billing', 'complaints', 'entry-activity', 'expenses', 'reports'],
  OWNER: ['dashboard', 'community', 'my-flat', 'billing', 'complaints', 'entry-activity'],
  TENANT: ['dashboard', 'community', 'my-flat', 'billing', 'complaints', 'entry-activity'],
};

const LEGACY_MENU_ID_MAP: Record<string, MenuId> = {
  announcements: 'community',
  events: 'community',
};

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

function getPhonePeAuthBaseUrl(environment: string) {
  return environment === 'PRODUCTION'
    ? 'https://api.phonepe.com/apis/identity-manager'
    : 'https://api-preprod.phonepe.com/apis/pg-sandbox';
}

function resolveSettingsSocietyId(req: AuthRequest, providedSocietyId?: string) {
  if (req.user?.role === 'SUPER_ADMIN') {
    return providedSocietyId || req.user.societyId || null;
  }

  return req.user?.societyId || null;
}

function isConfigurableMenuRole(value: string): value is ConfigurableMenuRole {
  return (CONFIGURABLE_MENU_ROLES as readonly string[]).includes(value);
}

function parseVisibleMenuIds(rawValue?: string | null): MenuId[] {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeMenuIds(parsed);
  } catch {
    return [];
  }
}

function normalizeMenuIds(value: unknown): MenuId[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => LEGACY_MENU_ID_MAP[item] || item)
    .filter((item): item is MenuId => MENU_ID_SET.has(item as MenuId));

  return [...new Set(normalized)];
}

function normalizeVisibleMenuIds(role: ConfigurableMenuRole, value: unknown): MenuId[] {
  const requestedIds = Array.isArray(value)
    ? normalizeMenuIds(value)
    : DEFAULT_MENU_IDS_BY_ROLE[role];

  const mandatoryIds = new Set(BASELINE_MENU_IDS_BY_ROLE[role]);
  const allowedIds = new Set(ALLOWED_MENU_IDS_BY_ROLE[role]);

  const normalizedIds = [...new Set(requestedIds)].filter((item) => allowedIds.has(item));
  for (const mandatoryId of mandatoryIds) {
    if (!normalizedIds.includes(mandatoryId)) {
      normalizedIds.push(mandatoryId);
    }
  }

  return MENU_CATALOG.filter((item) => normalizedIds.includes(item.id)).map((item) => item.id);
}

function buildRoleMenuConfig(role: ConfigurableMenuRole, storedVisibleMenuIds: MenuId[]) {
  const mandatoryMenuIds = BASELINE_MENU_IDS_BY_ROLE[role];
  const defaultMenuIds = DEFAULT_MENU_IDS_BY_ROLE[role];
  const allowedIds = ALLOWED_MENU_IDS_BY_ROLE[role];
  const allowedIdSet = new Set<MenuId>(allowedIds);
  const mandatoryIdSet = new Set<MenuId>(mandatoryMenuIds);
  const defaultIdSet = new Set<MenuId>(defaultMenuIds);
  const visibleMenuIds = normalizeVisibleMenuIds(role, storedVisibleMenuIds.length > 0 ? storedVisibleMenuIds : defaultMenuIds);
  const visibleIdSet = new Set<MenuId>(visibleMenuIds);

  return {
    role,
    roleLabel: ROLE_LABELS[role],
    mandatoryMenuIds,
    defaultMenuIds,
    visibleMenuIds,
    menuItems: MENU_CATALOG.map((item) => ({
      id: item.id,
      label: item.label,
      href: item.href,
      allowed: allowedIdSet.has(item.id),
      mandatory: mandatoryIdSet.has(item.id),
      enabled: visibleIdSet.has(item.id),
      defaultEnabled: defaultIdSet.has(item.id),
      selectable: allowedIdSet.has(item.id) && !mandatoryIdSet.has(item.id),
    })),
  };
}

async function getRoleMenuConfigResponse(societyId: string) {
  const configs = await prisma.societyRoleMenuConfig.findMany({
    where: {
      societyId,
      role: { in: [...CONFIGURABLE_MENU_ROLES] as Role[] },
    },
  });

  const configMap = new Map<ConfigurableMenuRole, MenuId[]>();
  for (const config of configs) {
    if (isConfigurableMenuRole(config.role)) {
      configMap.set(config.role, parseVisibleMenuIds(config.visibleMenuIds));
    }
  }

  return {
    societyId,
    configurableRoles: CONFIGURABLE_MENU_ROLES.map((role) => buildRoleMenuConfig(role, configMap.get(role) || [])),
  };
}

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
  [
    param('role').isIn([...CONFIGURABLE_MENU_ROLES]).withMessage('Invalid role'),
    body('visibleMenuIds').isArray().withMessage('visibleMenuIds must be an array'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const role = req.params.role as ConfigurableMenuRole;
      const societyId = resolveSettingsSocietyId(req, req.body.societyId);
      if (!societyId) return res.status(400).json({ error: 'Society ID required' });

      const visibleMenuIds = normalizeVisibleMenuIds(role, req.body.visibleMenuIds);
      const defaultMenuIds = DEFAULT_MENU_IDS_BY_ROLE[role];
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
          clientId: '',
          clientSecret: '',
          clientVersion: 1,
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
      clientSecret: config.clientSecret ? `${'•'.repeat(Math.max(0, config.clientSecret.length - 4))}${config.clientSecret.slice(-4)}` : '',
      clientSecretSet: !!config.clientSecret,
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
    body('clientId').optional({ values: 'falsy' }).isString(),
    body('clientSecret').optional({ values: 'falsy' }).isString(),
    body('clientVersion').optional().isInt({ min: 1 }),
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

      const { merchantId, clientId, clientSecret, clientVersion, saltKey, saltIndex, environment, redirectUrl, callbackUrl } = req.body;
      const requestOrigin = getRequestOrigin(req);

      const existing = await prisma.paymentGatewayConfig.findUnique({
        where: { societyId_gateway: { societyId, gateway: 'PHONEPE' } },
      });

      const normalizedClientId = typeof clientId === 'string' ? clientId.trim() : '';
      const normalizedClientSecret = typeof clientSecret === 'string' ? clientSecret.trim() : '';
      if ((normalizedClientId && !normalizedClientSecret && !existing?.clientSecret) || (!normalizedClientId && normalizedClientSecret)) {
        return res.status(400).json({ error: 'Client ID and Client Secret must be provided together' });
      }

      // Determine base URL from environment
      const baseUrl =
        environment === 'PRODUCTION'
          ? 'https://api.phonepe.com/apis/hermes'
          : 'https://api-preprod.phonepe.com/apis/pg-sandbox';

      const resolvedCallbackUrl = callbackUrl || (requestOrigin ? `${requestOrigin}/api/payments/phonepe/callback` : '');
      const resolvedSaltKey = saltKey || existing?.saltKey || '';
      const resolvedClientId = normalizedClientId || existing?.clientId || '';
      const resolvedClientSecret = normalizedClientSecret || existing?.clientSecret || '';

      const config = await prisma.paymentGatewayConfig.upsert({
        where: { societyId_gateway: { societyId, gateway: 'PHONEPE' } },
        update: {
          gateway: 'PHONEPE',
          merchantId,
          clientId: resolvedClientId || null,
          clientSecret: resolvedClientSecret || null,
          clientVersion: Number(clientVersion) > 0 ? Number(clientVersion) : existing?.clientVersion || 1,
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
          clientId: resolvedClientId || null,
          clientSecret: resolvedClientSecret || null,
          clientVersion: Number(clientVersion) > 0 ? Number(clientVersion) : 1,
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
          clientSecret: config.clientSecret ? `${'•'.repeat(Math.max(0, config.clientSecret.length - 4))}${config.clientSecret.slice(-4)}` : '',
          clientSecretSet: !!config.clientSecret,
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

    const startTime = Date.now();

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

    // Fallback for legacy redirect credentials when SDK client credentials are not configured.
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
  [
    param('userId').isUUID(),
    body('role').isIn([...ASSIGNABLE_ROLES]).withMessage('Invalid role'),
  ],
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

      // SECRETARY cannot change an ADMIN's role
      if (req.user!.role === 'SECRETARY' && membership.role === 'ADMIN') {
        return res.status(403).json({ error: 'Cannot change the Admin\'s role' });
      }

      // Prevent removing the last ADMIN
      if (membership.role === 'ADMIN' && newRole !== 'ADMIN') {
        const adminCount = await prisma.userSocietyMembership.count({
          where: { societyId, role: 'ADMIN' },
        });
        if (adminCount <= 1) {
          return res.status(400).json({ error: 'Society must have at least one Admin' });
        }
      }

      // Enforce role limits (only when assigning TO a limited role)
      const limit = ROLE_LIMITS[newRole];
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
        data: { role: newRole },
      });

      // Also update user.role to match (for backward compat with token generation)
      await prisma.user.update({
        where: { id: userId },
        data: { role: newRole },
      });

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

router.delete(
  '/members/:userId',
  [
    param('userId').isUUID(),
    body('reason').trim().notEmpty().withMessage('Reason is required'),
  ],
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

export default router;
