import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Liveness + database check for the hosting platform / uptime monitor. Reveals nothing else. */
export async function GET() {
  try {
    await (await getDb()).execute(sql`select 1`);
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 503);
  }
}
