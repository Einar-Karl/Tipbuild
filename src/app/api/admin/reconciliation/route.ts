import { getDb } from '@/db';
import { getConfig } from '@/lib/config';
import { api, ApiError, json } from '@/lib/http';
import { getProvider } from '@/lib/provider';
import { reconcile } from '@/lib/reconciliation';
import { requireAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** `?designated_balance_minor=` lets the owner enter the balance of the safeguarding account (platform_pooled). */
export const GET = api(async (req) => {
  await requireAdmin(req);
  const raw = new URL(req.url).searchParams.get('designated_balance_minor');
  let designated: number | null = null;
  if (raw !== null && raw !== '') {
    designated = Number(raw);
    if (!Number.isInteger(designated) || designated < 0) throw new ApiError(400, 'invalid_balance');
  }
  return json(await reconcile(await getDb(), getConfig(), { provider: getProvider(), designatedBalanceMinor: designated }));
});
