import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { tips } from '@/db/schema';
import { getEnv } from '@/env';
import { getConfig } from '@/lib/config';
import { api, ApiError, json, limit, parseBody } from '@/lib/http';
import { getProvider } from '@/lib/provider';
import { MockProvider, mockProcessorFee } from '@/lib/provider/mock';
import { handleWebhook } from '@/lib/webhooks';

export const dynamic = 'force-dynamic';

const body = z.object({ tipId: z.string().uuid(), outcome: z.enum(['success', 'fail']).default('success') });

/** Fake card flow for the MockProvider: confirms a payment by sending a signed webhook through the real pipeline. */
export const POST = api(async (req) => {
  const env = getEnv();
  const provider = getProvider();
  if (env.PAYMENT_PROVIDER !== 'mock' || !(provider instanceof MockProvider)) throw new ApiError(404, 'not_found');
  limit(req, 'mock-pay', 30, 60_000);
  const { tipId, outcome } = await parseBody(req, body);
  const db = await getDb();
  const [tip] = await db.select().from(tips).where(eq(tips.id, tipId));
  if (!tip?.providerPaymentId) throw new ApiError(404, 'not_found');
  const event =
    outcome === 'success'
      ? ({
          id: `evt_mock_${crypto.randomUUID()}`,
          type: 'payment.succeeded',
          paymentId: tip.providerPaymentId,
          tipId: tip.id,
          amountMinor: tip.amountMinor,
          currency: tip.currency,
          processorFeeMinor: mockProcessorFee(tip.amountMinor),
        } as const)
      : ({ id: `evt_mock_${crypto.randomUUID()}`, type: 'payment.failed', paymentId: tip.providerPaymentId, tipId: tip.id } as const);
  const { rawBody, signature } = provider.deliver(event);
  const result = await handleWebhook(db, provider, getConfig(), rawBody, signature);
  return json({ ok: true, result });
});
