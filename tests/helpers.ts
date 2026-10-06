import { createPgliteDb } from '@/db/pglite';
import type { Db } from '@/db/types';
import { guides, tours, users, operators, type Guide } from '@/db/schema';

export async function testDb(): Promise<Db> {
  return createPgliteDb();
}

let n = 0;
export async function makeGuide(
  db: Db,
  over: Partial<typeof guides.$inferInsert> = {},
): Promise<Guide> {
  n += 1;
  const [u] = await db.insert(users).values({ email: `guide${n}-${Date.now()}@example.com` }).returning();
  const [g] = await db
    .insert(guides)
    .values({
      userId: u!.id,
      displayName: `Guide ${n}`,
      slug: `guide-${n}-${Math.random().toString(36).slice(2, 6)}`,
      payoutStatus: 'active',
      payoutAccountId: `mock_acct_${n}_${Math.random().toString(36).slice(2, 8)}`,
      ...over,
    })
    .returning();
  await db.insert(tours).values({ guideId: g!.id, title: 'City walk' });
  return g!;
}

export async function makeOperator(db: Db, over: Partial<typeof operators.$inferInsert> = {}) {
  const [o] = await db.insert(operators).values({ name: 'Test Tours', ...over }).returning();
  return o!;
}
