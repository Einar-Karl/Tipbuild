import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { guides } from '@/db/schema';
import { audit } from '@/lib/audit';
import { api, json, parseBody } from '@/lib/http';
import { requireAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Assign a guide to a tour operator company (or remove them: operatorId = null). */
export const PATCH = api(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(req);
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return json({ error: 'not_found' }, 404);
  const { operatorId } = await parseBody(req, z.object({ operatorId: z.string().uuid().nullable() }));
  const db = await getDb();
  const [before] = await db.select().from(guides).where(eq(guides.id, id));
  if (!before) return json({ error: 'not_found' }, 404);
  const [after] = await db.update(guides).set({ operatorId }).where(eq(guides.id, id)).returning();
  await audit(db, { actor: `admin:${admin.id}`, action: 'guide.operator_changed', entity: 'guide', entityId: id, meta: { from: before.operatorId, to: operatorId } });
  return json({ guide: after });
});
