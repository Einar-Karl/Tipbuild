import type { Db } from '@/db/types';
import { auditLog } from '@/db/schema';

export async function audit(
  db: Db,
  e: { actor: string; action: string; entity: string; entityId?: string | null; meta?: Record<string, unknown> },
): Promise<void> {
  await db.insert(auditLog).values({
    actor: e.actor,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId ?? null,
    meta: e.meta ?? {},
  });
}
