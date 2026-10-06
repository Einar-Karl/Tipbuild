import { getDb } from '@/db';
import { api, json } from '@/lib/http';
import { listGuidePayouts } from '@/lib/guides';
import { requireGuide } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  const { guide } = await requireGuide(req);
  return json({ payouts: await listGuidePayouts(await getDb(), guide.id) });
});
