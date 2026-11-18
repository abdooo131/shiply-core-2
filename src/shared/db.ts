import { PrismaClient } from '@prisma/client';

// One client per process. In development Next.js reloads modules, so keep the
// client on globalThis to avoid opening a new connection pool on every reload.
const globalForDb = globalThis as unknown as { shiplyDb?: PrismaClient };

export const db: PrismaClient = globalForDb.shiplyDb ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForDb.shiplyDb = db;
}
