import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { payouts } from '@/db/schema';
import { api, json } from '@/lib/http';
import { requireGuide } from '@/lib/session';
import { buildStatement, statementPdf } from '@/lib/statements';

export const dynamic = 'force-dynamic';

export const GET = api(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { guide } = await requireGuide(req);
  const { id } = await ctx.params;
  const db = await getDb();
  const [p] = /^[0-9a-f-]{36}$/i.test(id) ? await db.select({ id: payouts.id }).from(payouts).where(and(eq(payouts.id, id), eq(payouts.guideId, guide.id))) : [];
  const s = p ? await buildStatement(db, p.id) : null;
  if (!s) return json({ error: 'not_found' }, 404);
  const pdf = await statementPdf(s);
  return new Response(new Uint8Array(pdf), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="statement-${s.periodStart.slice(0, 7)}.pdf"` },
  });
});
