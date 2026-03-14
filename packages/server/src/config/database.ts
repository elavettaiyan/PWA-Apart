import { PrismaClient } from '@prisma/client';
import logger from './logger';

// Support Supabase-style env var names — map to DATABASE_URL which Prisma expects
if (!process.env.DATABASE_URL && process.env.APART_EASE_POSTGRES_PRISMA_URL) {
  process.env.DATABASE_URL = process.env.APART_EASE_POSTGRES_PRISMA_URL;
}

let prisma: PrismaClient;

try {
  if (!process.env.DATABASE_URL) {
    logger.error('❌ DATABASE_URL (or APART_EASE_POSTGRES_PRISMA_URL) environment variable is not set!');
  }

  prisma = new PrismaClient({
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
} catch (err: any) {
  logger.error('❌ Failed to initialize PrismaClient', { error: err.message });
  // Create a proxy that throws clear errors when accessed
  prisma = new Proxy({} as PrismaClient, {
    get(_target, prop) {
      if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;
      throw new Error(
        `Database is not available. PrismaClient failed to initialize. ` +
        `Ensure DATABASE_URL is set correctly. Original error: ${err.message}`,
      );
    },
  });
}

export default prisma;
