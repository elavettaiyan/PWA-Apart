import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import logger from './config/logger';
import prisma from './config/database';
import { errorHandler, notFound } from './middleware/errorHandler';
import { rateLimit } from 'express-rate-limit';

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

const app = express();

// ── REQUEST LOGGING MIDDLEWARE ──────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = res;
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    logger[level](`${method} ${originalUrl} ${statusCode} - ${duration}ms`, {
      method,
      url: originalUrl,
      status: statusCode,
      duration,
      ip: req.ip,
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
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

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

// ── API ROUTES ──────────────────────────────────────────
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', registerLimiter);
app.use('/api/auth/register-society', registerLimiter);
app.use('/api/auth/refresh', authLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/flats', flatRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/association', associationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingsRoutes);

// ── ERROR HANDLING ──────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── START SERVER (local only, not on Vercel) ────────────
if (process.env.VERCEL !== '1') {
  app.listen(config.port, () => {
    logger.info(`🚀 Server running on http://localhost:${config.port}`);
    logger.info(`📋 Environment: ${config.nodeEnv}`);
    logger.info(`🔗 Client URL: ${config.clientUrl}`);
    logger.info(`🗄️  Database URL: ${process.env.DATABASE_URL ? '***set***' : '⚠️  NOT SET'}`);
    logger.info(`🔑 JWT Secret: ${config.jwt.secret === 'fallback-secret' ? '⚠️  USING FALLBACK' : '***set***'}`);
  });
} else {
  logger.info('Running on Vercel serverless');
  logger.info(`🗄️  Database URL: ${(process.env.DATABASE_URL || process.env.APART_EASE_POSTGRES_PRISMA_URL) ? '***set***' : '⚠️  NOT SET'}`);
  logger.info(`🔑 JWT Secret: ${config.jwt.secret === 'fallback-secret' ? '⚠️  USING FALLBACK' : '***set***'}`);
}

export default app;
