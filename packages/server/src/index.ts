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
app.use(cors({
  origin: config.nodeEnv === 'production'
    ? (config.clientUrl === 'http://localhost:5173' ? true : config.clientUrl)
    : config.clientUrl,
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ── HEALTH CHECK ────────────────────────────────────────
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
    database: dbStatus,
    environment: config.nodeEnv,
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

// ── START SERVER ────────────────────────────────────────
app.listen(config.port, () => {
  logger.info(`🚀 Server running on http://localhost:${config.port}`);
  logger.info(`📋 Environment: ${config.nodeEnv}`);
  logger.info(`🔗 Client URL: ${config.clientUrl}`);
  logger.info(`🗄️  Database URL: ${process.env.DATABASE_URL ? '***set***' : '⚠️  NOT SET'}`);
  logger.info(`🔑 JWT Secret: ${config.jwt.secret === 'fallback-secret' ? '⚠️  USING FALLBACK' : '***set***'}`);
});

export default app;
