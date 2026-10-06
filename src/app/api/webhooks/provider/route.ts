import { getDb } from '@/db';
import { getConfig } from '@/lib/config';
import { api, json } from '@/lib/http';
import { MOCK_SIGNATURE_HEADER } from '@/lib/provider/mock';
import { getProvider } from '@/lib/provider';
import { handleWebhook } from '@/lib/webhooks';

export const dynamic = 'force-dynamic';

export const POST = api(async (req) => {
  const provider = getProvider();
  const raw = await req.text(); // raw body is required for signature verification
  const signature = req.headers.get(provider.name === 'stripe' ? 'stripe-signature' : MOCK_SIGNATURE_HEADER);
  const outcome = await handleWebhook(await getDb(), provider, getConfig(), raw, signature);
  return json({ received: true, outcome });
});
