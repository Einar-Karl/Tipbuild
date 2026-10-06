import { getDb } from '@/db';
import { getConfig } from '@/lib/config';
import { requireCron } from '@/lib/cron';
import { snapshotFloat } from '@/lib/float';
import { api, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

const handler = api(async (req) => {
  requireCron(req);
  return json({ snapshot: await snapshotFloat(await getDb(), getConfig()) });
});

export const GET = handler;
export const POST = handler;
