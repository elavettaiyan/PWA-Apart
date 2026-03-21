import { PrismaClient } from '@prisma/client';
import logger from './logger';

// Support Supabase-style env var names — map to DATABASE_URL which Prisma expects
if (!process.env.DATABASE_URL && process.env.APART_EASE_POSTGRES_PRISMA_URL) {
  process.env.DATABASE_URL = process.env.APART_EASE_POSTGRES_PRISMA_URL;
}

let prisma: PrismaClient;

// Resolved when Prisma has an open connection. Awaited by the dbReady middleware
// so cold-start requests don't pay connection latency inside their first query.
let dbReadyResolve: () => void;
export const dbReady: Promise<void> = new Promise((resolve) => {
  dbReadyResolve = resolve;
});

try {
  if (!process.env.DATABASE_URL) {
    logger.error('❌ DATABASE_URL (or APART_EASE_POSTGRES_PRISMA_URL) environment variable is not set!');
  }

  prisma = new PrismaClient({
    datasources: process.env.NODE_ENV === 'production' ? {
      db: {
        url: `${process.env.DATABASE_URL}${process.env.DATABASE_URL?.includes('?') ? '&' : '?'}connection_limit=1&pool_timeout=20`,
      },
    } : undefined,
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

  // Eagerly connect — all incoming requests await dbReady before touching the DB.
  prisma.$connect()
    .then(() => {
      logger.info('✅ Database connected successfully');
      dbReadyResolve();
    })
    .catch((err: Error) => {
      logger.error('❌ Database connection failed', { error: err.message });
      // Resolve anyway so requests aren't stuck forever — they'll get a DB error naturally.
      dbReadyResolve();
    });
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
