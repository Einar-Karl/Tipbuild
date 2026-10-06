import { z } from 'zod';
import { getDb } from '@/db';
import { api, json, limit, parseBody } from '@/lib/http';
import { rateTip } from '@/lib/tips';

export const dynamic = 'force-dynamic';

const body = z.object({ rating: z.number().int().min(1).max(5), text: z.string().max(1000).optional() });

export const POST = api(async (req, ctx: { params: Promise<{ id: string }> }) => {
  limit(req, 'tip-rating', 20, 60_000);
  const { id } = await ctx.params;
  const { rating, text } = await parseBody(req, body);
  const res = await rateTip(await getDb(), id, rating, text);
  return json(res);
});
