import { PrismaClient } from '@prisma/client';
import logger from './logger';

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ]
    : [{ emit: 'event', level: 'error' }],
});

// Log Prisma errors
prisma.$on('error' as never, (e: any) => {
  logger.error('Prisma error', { message: e.message, target: e.target });
});

// Test DB connection on startup
prisma.$connect()
  .then(() => logger.info('✅ Database connected successfully'))
  .catch((err: Error) => logger.error('❌ Database connection failed', { error: err.message }));

export default prisma;
