import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import logger from './config/logger';
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

// ── MIDDLEWARE ───────────────────────────────────────────
app.use(cors({ origin: config.clientUrl, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ── HEALTH CHECK ────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
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
  logger.info(`🔗 API docs: http://localhost:${config.port}/api/health`);
});

export default app;
