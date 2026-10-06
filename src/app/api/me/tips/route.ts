import { getDb } from '@/db';
import { api, json } from '@/lib/http';
import { listGuideTips } from '@/lib/guides';
import { requireGuide } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  const { guide } = await requireGuide(req);
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);
  return json({ tips: await listGuideTips(await getDb(), guide.id, limit, offset) });
});
