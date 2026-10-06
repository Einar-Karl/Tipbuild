import { getDb } from '@/db';
import { adminSummary } from '@/lib/admin';
import { getConfig } from '@/lib/config';
import { api, json } from '@/lib/http';
import { requireAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  await requireAdmin(req);
  return json(await adminSummary(await getDb(), getConfig().currency));
});
