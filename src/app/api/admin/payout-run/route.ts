import { z } from 'zod';
import { getDb } from '@/db';
import { getConfig } from '@/lib/config';
import { api, json, parseBody } from '@/lib/http';
import { runMonthlyPayout } from '@/lib/payouts';
import { getProvider } from '@/lib/provider';
import { requireAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Manual trigger of the monthly payout run (same code path as the cron). Idempotent per guide and month. */
export const POST = api(async (req) => {
  const admin = await requireAdmin(req);
  const { period } = await parseBody(req, z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }));
  const result = await runMonthlyPayout(await getDb(), { provider: getProvider(), cfg: getConfig(), period, actor: `admin:${admin.id}` });
  return json(result);
});
