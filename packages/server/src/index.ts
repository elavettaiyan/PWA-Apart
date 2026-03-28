import express, { Request } from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import logger from './config/logger';
import prisma from './config/database';
import { dbReady } from './config/database';
import { errorHandler, notFound } from './middleware/errorHandler';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

// Route modules
import authRoutes from './modules/auth/routes';
import flatRoutes from './modules/flats/routes';
import billingRoutes from './modules/billing/routes';
import paymentRoutes from './modules/payments/routes';
import complaintRoutes from './modules/complaints/routes';
import expenseRoutes from './modules/expenses/routes';
import associationRoutes from './modules/association/routes';
import reportRoutes from './modules/reports/routes';
import settingsRoutes from './modules/settings/routes';
import adminRoutes from './modules/admin/routes';
import staffRoutes from './modules/staff/routes';
import visitorRoutes from './modules/visitors/routes';
import deliveryRoutes from './modules/deliveries/routes';
import premiumRoutes, { premiumWebhookHandler } from './modules/premium/routes';
import notificationRoutes from './modules/notifications/routes';

const app = express();
const processStartMs = Date.now();
const serverInstanceId = Math.random().toString(36).slice(2, 10);

// In production (Vercel/Railway/reverse proxy), trust forwarded headers for real client IP.
// Use numeric value (1 = trust first proxy) to avoid express-rate-limit ERR_ERL_PERMISSIVE_TRUST_PROXY.
// Also enable when RAILWAY_ENVIRONMENT is set (Railway doesn't always set NODE_ENV).
const isBehindProxy = config.nodeEnv === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
app.set('trust proxy', isBehindProxy ? 1 : false);

const normalizeIdentifier = (value: unknown): string => {
  if (typeof value !== 'string') {
    return 'unknown';
  }

  return value.trim().toLowerCase();
};

const registrationKey = (req: Request): string => {
  const body = typeof req.body === 'object' && req.body !== null ? req.body as Record<string, unknown> : {};

  const email = normalizeIdentifier(body.email);
  const phone = normalizeIdentifier(body.phone);
  const identity = email !== 'unknown' ? `email:${email}` : phone !== 'unknown' ? `phone:${phone}` : 'anonymous';
  const ipKey = ipKeyGenerator(req.ip || 'unknown');

  return `${req.path}:${identity}:${ipKey}`;
};

// ── REQUEST LOGGING MIDDLEWARE ──────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const uptimeMs = Date.now() - processStartMs;
    const { statusCode } = res;
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    logger[level](`${method} ${originalUrl} ${statusCode} - ${duration}ms`, {
      method,
      url: originalUrl,
      status: statusCode,
      duration,
      ip: req.ip,
      uptimeMs,
      coldStart: uptimeMs < 30000,
      instanceId: serverInstanceId,
      region: process.env.VERCEL_REGION || process.env.RAILWAY_REGION || 'unknown',
    });
  });

  next();
});

// ── MIDDLEWARE ───────────────────────────────────────────
const allowedOrigins = [config.clientUrl];
// Always allow the known Vercel client URL
if (config.clientUrl !== 'https://pwa-apart-client.vercel.app') {
  allowedOrigins.push('https://pwa-apart-client.vercel.app');
}
// Allow custom domains (both www and apex)
for (const domain of [
  'https://www.dwellhub.in', 'https://dwellhub.in', 'https://app.dwellhub.in',
  'https://www.resilynk.com', 'https://resilynk.com',
]) {
  if (!allowedOrigins.includes(domain)) {
    allowedOrigins.push(domain);
  }
}
// Allow Capacitor WebView origins for mobile apps.
for (const mobileOrigin of ['https://localhost', 'http://localhost', 'capacitor://localhost']) {
  if (!allowedOrigins.includes(mobileOrigin)) {
    allowedOrigins.push(mobileOrigin);
  }
}

app.use(cors({
  origin: config.nodeEnv === 'production'
    ? (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        logger.warn('CORS blocked', { origin, allowedOrigins });
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    : true,
  credentials: true,
  exposedHeaders: ['X-User-Role'],
}));

// ── SECURITY HEADERS ────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (config.nodeEnv === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// ── RATE LIMITING ───────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 registrations per hour
  message: { error: 'Too many registration attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: registrationKey,
  skip: () => config.nodeEnv !== 'production',
});

// Razorpay webhooks require the raw body for signature verification, so this
// route must be registered before the global JSON parser.
app.post('/api/premium/webhook', express.raw({ type: 'application/json', limit: '1mb' }), premiumWebhookHandler);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Allow larger body for bulk Excel upload (5mb)
app.use('/api/flats/bulk-upload', express.raw({ type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', limit: '5mb' }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ── HEALTH CHECK (sanitized — no secrets/config leaked) ─
app.get('/api/health', async (_req, res) => {
  let dbStatus = 'disconnected';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch (err: any) {
    logger.error('Health check DB failure', { error: err.message });
  }

  res.json({
    status: dbStatus === 'connected' ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// ── WAIT FOR DB ON COLD START ───────────────────────────
// On serverless cold starts, $connect() runs in the background during module
// init. This middleware ensures the connection is open before any route handler
// touches the database, so the first request's auth query doesn't pay the
// ~1-2s connection establishment cost.
app.use('/api', async (_req, _res, next) => {
  await dbReady;
  next();
});

// ── API ROUTES ──────────────────────────────────────────
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', registerLimiter);
app.use('/api/auth/register-society', registerLimiter);
app.use('/api/auth/refresh', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/flats', flatRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/association', associationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/visitors', visitorRoutes);
app.use('/api/deliveries', deliveryRoutes);
app.use('/api/premium', premiumRoutes);
app.use('/api/notifications', notificationRoutes);

// ── ERROR HANDLING ──────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── START SERVER (local & Railway — not on Vercel) ──────
if (process.env.VERCEL !== '1') {
  const host = '0.0.0.0';
  app.listen(config.port, host, () => {
    logger.info(`🚀 Server running on ${host}:${config.port}`);
    logger.info(`📋 Environment: ${config.nodeEnv}`);
    logger.info(`🔗 Client URL: ${config.clientUrl}`);
    logger.info(`🗄️  Database URL: ${process.env.DATABASE_URL ? '***set***' : '⚠️  NOT SET'}`);
    logger.info(`🔑 JWT Secret: ${config.jwt.secret === 'fallback-secret' ? '⚠️  USING FALLBACK' : '***set***'}`);
    if (process.env.RAILWAY_ENVIRONMENT) {
      logger.info(`🚂 Railway environment: ${process.env.RAILWAY_ENVIRONMENT}`);
    }
  });
} else {
  logger.info('Running on Vercel serverless');
  logger.info(`🗄️  Database URL: ${(process.env.DATABASE_URL || process.env.APART_EASE_POSTGRES_PRISMA_URL) ? '***set***' : '⚠️  NOT SET'}`);
  logger.info(`🔑 JWT Secret: ${config.jwt.secret === 'fallback-secret' ? '⚠️  USING FALLBACK' : '***set***'}`);
}

export default app;
