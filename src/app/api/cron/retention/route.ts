import { getDb } from '@/db';
import { getEnv } from '@/env';
import { requireCron } from '@/lib/cron';
import { api, json } from '@/lib/http';
import { runRetention } from '@/lib/retention';

export const dynamic = 'force-dynamic';

const handler = api(async (req) => {
  requireCron(req);
  return json(await runRetention(await getDb(), { retentionMonths: getEnv().RETENTION_MONTHS }));
});

export const GET = handler;
export const POST = handler;
