import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { payouts } from '@/db/schema';
import { api, json } from '@/lib/http';
import { requireGuide } from '@/lib/session';
import { buildStatement, statementCsv } from '@/lib/statements';

export const dynamic = 'force-dynamic';

export const GET = api(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { guide } = await requireGuide(req);
  const { id } = await ctx.params;
  const db = await getDb();
  // Ownership check: a guide can only ever read their own statements.
  const [p] = /^[0-9a-f-]{36}$/i.test(id) ? await db.select({ id: payouts.id }).from(payouts).where(and(eq(payouts.id, id), eq(payouts.guideId, guide.id))) : [];
  const s = p ? await buildStatement(db, p.id) : null;
  if (!s) return json({ error: 'not_found' }, 404);
  return new Response(statementCsv(s), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="statement-${s.periodStart.slice(0, 7)}.csv"` },
  });
});
