import { getDb } from '@/db';
import { getConfig } from '@/lib/config';
import { floatReport } from '@/lib/float';
import { api, ApiError, json } from '@/lib/http';
import { requireAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  await requireAdmin(req);
  const url = new URL(req.url);
  const d = (k: string) => {
    const v = url.searchParams.get(k);
    if (!v) return undefined;
    const x = new Date(`${v}T00:00:00Z`);
    if (Number.isNaN(x.getTime())) throw new ApiError(400, 'invalid_date');
    return x;
  };
  return json(await floatReport(await getDb(), getConfig(), { from: d('from'), to: d('to') }));
});
