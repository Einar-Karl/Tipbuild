import './_env';
import path from 'node:path';
import { getEnv } from '../src/env';

async function main() {
  const env = getEnv();
  if (!env.DATABASE_URL) {
    // PGlite migrates itself on open.
    const { getDb } = await import('../src/db');
    await getDb();
    console.log('PGlite database is up to date.');
    return;
  }
  const { Pool } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  await migrate(drizzle(pool), { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  await pool.end();
  console.log('Migrations applied.');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
