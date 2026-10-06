import type { PgDatabase } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

/** Works for both node-postgres and PGlite, and for transactions. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;
