import fs from 'node:fs';
import path from 'node:path';
import * as schema from './schema';
import type { Db } from './types';

/**
 * Embedded Postgres (PGlite). Used for local dev without a database server,
 * for tests and for e2e. Production uses DATABASE_URL (node-postgres).
 * `dir` undefined => in-memory.
 */
export async function createPgliteDb(dir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  return db as unknown as Db;
}
