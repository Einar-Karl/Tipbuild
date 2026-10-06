import { z } from 'zod';
import { getDb } from '@/db';
import { getEnv } from '@/env';
import { getConfig } from '@/lib/config';
import { api, ApiError, json, parseBody } from '@/lib/http';
import { getProvider } from '@/lib/provider';
import { MockProvider } from '@/lib/provider/mock';
import { requireGuide } from '@/lib/session';
import { handleWebhook } from '@/lib/webhooks';

export const dynamic = 'force-dynamic';

/** MockProvider only: pretend the guide finished KYC + bank details; delivered as a signed account.updated webhook. */
export const POST = api(async (req) => {
  const provider = getProvider();
  if (getEnv().PAYMENT_PROVIDER !== 'mock' || !(provider instanceof MockProvider)) throw new ApiError(404, 'not_found');
  const { guide } = await requireGuide(req);
  const { account } = await parseBody(req, z.object({ account: z.string().min(1) }));
  if (guide.payoutAccountId !== account) throw new ApiError(403, 'forbidden');
  const { rawBody, signature } = provider.deliver({
    id: `evt_mock_${crypto.randomUUID()}`,
    type: 'account.updated',
    accountId: account,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  await handleWebhook(await getDb(), provider, getConfig(), rawBody, signature);
  return json({ ok: true });
});
