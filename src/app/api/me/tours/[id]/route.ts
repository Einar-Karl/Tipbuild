import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { tours } from '@/db/schema';
import { api, json, parseBody } from '@/lib/http';
import { requireGuide } from '@/lib/session';

export const dynamic = 'force-dynamic';

const patch = z.object({ title: z.string().trim().min(2).max(80).optional(), active: z.boolean().optional() });

export const PATCH = api(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { guide } = await requireGuide(req);
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return json({ error: 'not_found' }, 404);
  const input = await parseBody(req, patch);
  // Scoped to the caller's own guide: a guide can never touch another guide's tours.
  const [t] = await (await getDb())
    .update(tours)
    .set(input)
    .where(and(eq(tours.id, id), eq(tours.guideId, guide.id)))
    .returning();
  if (!t) return json({ error: 'not_found' }, 404);
  return json({ tour: t });
});
