import { getDb } from '@/db';
import { getConfig } from '@/lib/config';
import { requireCron } from '@/lib/cron';
import { api, json } from '@/lib/http';
import { runMonthlyPayout } from '@/lib/payouts';
import { getProvider } from '@/lib/provider';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const handler = api(async (req) => {
  requireCron(req);
  const period = new URL(req.url).searchParams.get('period') ?? undefined;
  const result = await runMonthlyPayout(await getDb(), { provider: getProvider(), cfg: getConfig(), period, actor: 'cron' });
  return json(result);
});

export const GET = handler;
export const POST = handler;
