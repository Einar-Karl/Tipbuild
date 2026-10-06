import { z } from 'zod';
import { getDb } from '@/db';
import { getConfig } from '@/lib/config';
import { api, json, limit, parseBody } from '@/lib/http';
import { getProvider } from '@/lib/provider';
import { createTip } from '@/lib/tips';

export const dynamic = 'force-dynamic';

const body = z.object({
  slug: z.string().min(1).max(80),
  amountMinor: z.number().int(),
  currency: z.string().length(3).optional(),
  coverFee: z.boolean().optional(),
  tourId: z.string().uuid().nullish(),
});

export const POST = api(async (req) => {
  limit(req, 'tip-intent', 20, 60_000);
  const input = await parseBody(req, body);
  const country = req.headers.get('x-vercel-ip-country');
  const db = await getDb();
  const created = await createTip(db, getProvider(), getConfig(), {
    slug: input.slug,
    tipMinor: input.amountMinor,
    currency: input.currency?.toUpperCase(),
    coverFee: input.coverFee,
    tourId: input.tourId,
    country,
  });
  return json(created, 201);
});
