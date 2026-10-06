import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { operators } from '@/db/schema';
import { audit } from '@/lib/audit';
import { api, json, parseBody } from '@/lib/http';
import { requireAdmin } from '@/lib/session';
import { operatorInput } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const PATCH = api(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(req);
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return json({ error: 'not_found' }, 404);
  const input = await parseBody(req, operatorInput.partial());
  const db = await getDb();
  const [before] = await db.select().from(operators).where(eq(operators.id, id));
  if (!before) return json({ error: 'not_found' }, 404);
  const set: Partial<typeof operators.$inferInsert> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.feeBpsOverride !== undefined) set.feeBpsOverride = input.feeBpsOverride;
  if (input.reviewUrl !== undefined) set.reviewUrl = input.reviewUrl || null;
  const [after] = await db.update(operators).set(set).where(eq(operators.id, id)).returning();
  // Fee changes move money: always audited with before/after.
  await audit(db, {
    actor: `admin:${admin.id}`,
    action: 'operator.updated',
    entity: 'operator',
    entityId: id,
    meta: { before: { feeBpsOverride: before.feeBpsOverride, name: before.name }, after: { feeBpsOverride: after!.feeBpsOverride, name: after!.name } },
  });
  return json({ operator: after });
});
