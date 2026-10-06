import { getDb } from '@/db';
import { api, json, limit } from '@/lib/http';
import { getPublicTip } from '@/lib/tips';

export const dynamic = 'force-dynamic';

export const GET = api(async (req, ctx: { params: Promise<{ id: string }> }) => {
  limit(req, 'tip-read', 120, 60_000);
  const { id } = await ctx.params;
  const tip = await getPublicTip(await getDb(), id);
  if (!tip) return json({ error: 'not_found' }, 404);
  return json(tip);
});
