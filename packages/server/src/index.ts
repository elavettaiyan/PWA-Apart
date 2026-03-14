import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import logger from './config/logger';
import prisma from './config/database';
import { errorHandler, notFound } from './middleware/errorHandler';

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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ── HEALTH CHECK ────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  let dbStatus = 'disconnected';
  let dbError: string | undefined;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch (err: any) {
    dbError = err.message;
    logger.error('Health check DB failure', { error: err.message });
  }

  const diagnostics: Record<string, string> = {};
  if (!process.env.DATABASE_URL && !process.env.APART_EASE_POSTGRES_PRISMA_URL) diagnostics.DATABASE_URL = 'NOT SET';
  if (config.jwt.secret === 'fallback-secret') diagnostics.JWT_SECRET = 'NOT SET (using fallback)';
  if (config.jwt.refreshSecret === 'fallback-refresh-secret') diagnostics.JWT_REFRESH_SECRET = 'NOT SET (using fallback)';

  res.json({
    status: dbStatus === 'connected' ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    database: dbStatus,
    ...(dbError && { databaseError: dbError }),
    environment: config.nodeEnv,
    clientUrl: config.clientUrl,
    ...(Object.keys(diagnostics).length > 0 && { missingEnvVars: diagnostics }),
  });
});

// ── API ROUTES ──────────────────────────────────────────
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
