import path from 'node:path';
import { getEnv } from '@/env';
import { createPgliteDb } from './pglite';
import * as schema from './schema';
import type { Db } from './types';

export type { Db } from './types';
export * as schema from './schema';

const g = globalThis as unknown as { __tipDb?: Promise<Db> };

async function createDb(): Promise<Db> {
  const env = getEnv();
  if (env.DATABASE_URL) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pool = new Pool({ connectionString: env.DATABASE_URL, max: 5 });
    return drizzle(pool, { schema }) as unknown as Db;
  }
  return createPgliteDb(path.resolve(env.PGLITE_DIR));
}

/** Process-wide singleton (survives Next.js module re-evaluation). */
export function getDb(): Promise<Db> {
  if (!g.__tipDb) {
    g.__tipDb = createDb().catch((e) => {
      g.__tipDb = undefined;
      throw e;
    });
  }
  return g.__tipDb;
}
