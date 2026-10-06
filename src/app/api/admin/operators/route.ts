import { getDb } from '@/db';
import { operators } from '@/db/schema';
import { listOperators } from '@/lib/admin';
import { audit } from '@/lib/audit';
import { api, json, parseBody } from '@/lib/http';
import { operatorInput } from '@/lib/schemas';
import { requireAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  await requireAdmin(req);
  return json({ operators: await listOperators(await getDb()) });
});

export const POST = api(async (req) => {
  const admin = await requireAdmin(req);
  const input = await parseBody(req, operatorInput);
  const db = await getDb();
  const [op] = await db
    .insert(operators)
    .values({ name: input.name, feeBpsOverride: input.feeBpsOverride ?? null, reviewUrl: input.reviewUrl || null })
    .returning();
  await audit(db, { actor: `admin:${admin.id}`, action: 'operator.created', entity: 'operator', entityId: op!.id, meta: { feeBpsOverride: input.feeBpsOverride ?? null } });
  return json({ operator: op }, 201);
});
