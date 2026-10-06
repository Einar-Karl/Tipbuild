import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '@/db/types';
import { guides, loginTokens, payouts, tips, tours, users, type Guide } from '@/db/schema';
import { audit } from './audit';
import { guidePayableBalance } from './ledger';
import { uniqueSlug } from './slug';
import { ApiError } from './http';

export function monthStartUtc(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export async function createGuideProfile(
  db: Db,
  args: { userId: string; displayName: string; tourTitle: string; avatarUrl?: string | null; currency: string },
): Promise<Guide> {
  const slug = await uniqueSlug(db, args.displayName);
  return db.transaction(async (tx) => {
    const [g] = await tx
      .insert(guides)
      .values({
        userId: args.userId,
        displayName: args.displayName,
        slug,
        avatarUrl: args.avatarUrl || null,
        defaultCurrency: args.currency,
      })
      .returning();
    await tx.insert(tours).values({ guideId: g!.id, title: args.tourTitle });
    await audit(tx as unknown as Db, { actor: `user:${args.userId}`, action: 'guide.created', entity: 'guide', entityId: g!.id });
    return g!;
  });
}

export interface GuideStats {
  balanceMinor: number;
  monthTipCount: number;
  monthNetMinor: number;
  avgRating: number | null;
  ratingCount: number;
}

export async function guideStats(db: Db, guide: Guide, now = new Date()): Promise<GuideStats> {
  const balanceMinor = await guidePayableBalance(db, guide.id, guide.defaultCurrency);
  const [m] = await db
    .select({ n: sql<number>`count(*)::int`, net: sql<string>`coalesce(sum(${tips.netMinor}), 0)` })
    .from(tips)
    .where(and(eq(tips.guideId, guide.id), eq(tips.status, 'succeeded'), gte(tips.createdAt, monthStartUtc(now))));
  const [r] = await db
    .select({ avg: sql<string | null>`avg(${tips.rating})`, n: sql<number>`count(${tips.rating})::int` })
    .from(tips)
    .where(and(eq(tips.guideId, guide.id), eq(tips.status, 'succeeded')));
  return {
    balanceMinor,
    monthTipCount: m?.n ?? 0,
    monthNetMinor: Number(m?.net ?? 0),
    avgRating: r?.avg ? Number(r.avg) : null,
    ratingCount: r?.n ?? 0,
  };
}

export async function listGuideTips(db: Db, guideId: string, limit = 50, offset = 0) {
  return db
    .select({
      id: tips.id,
      createdAt: tips.createdAt,
      tourTitle: tours.title,
      amountMinor: tips.amountMinor,
      feeMinor: tips.feeMinor,
      netMinor: tips.netMinor,
      currency: tips.currency,
      rating: tips.rating,
      reviewText: tips.reviewText,
      status: tips.status,
    })
    .from(tips)
    .leftJoin(tours, eq(tours.id, tips.tourId))
    .where(and(eq(tips.guideId, guideId), sql`${tips.status} <> 'pending'`))
    .orderBy(desc(tips.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function listGuidePayouts(db: Db, guideId: string) {
  return db.select().from(payouts).where(eq(payouts.guideId, guideId)).orderBy(desc(payouts.periodStart));
}

/** GDPR export: everything we hold about the guide (tourists are never identified). */
export async function exportGuideData(db: Db, guide: Guide, email: string | null) {
  const [t, p, tl] = await Promise.all([
    listGuideTips(db, guide.id, 100000, 0),
    listGuidePayouts(db, guide.id),
    db.select().from(tours).where(eq(tours.guideId, guide.id)),
  ]);
  return { exportedAt: new Date().toISOString(), account: { email }, guide, tours: tl, tips: t, payouts: p };
}

/**
 * GDPR erasure. Personal data is removed; financial records (tips, ledger, payouts) are kept
 * as required by accounting law but no longer point at a person. Refused while money is owed.
 */
export async function deleteGuideAccount(db: Db, guide: Guide, userId: string): Promise<void> {
  const balance = await guidePayableBalance(db, guide.id, guide.defaultCurrency);
  if (balance > 0) throw new ApiError(409, 'balance_outstanding', 'You still have a balance that has not been paid out. Delete your account after the next payout.');
  const open = await db.select({ id: payouts.id }).from(payouts).where(and(eq(payouts.guideId, guide.id), eq(payouts.status, 'pending'))).limit(1);
  if (open[0]) throw new ApiError(409, 'payout_pending', 'A payout is still in progress.');
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [u] = await t.select({ email: users.email }).from(users).where(eq(users.id, userId));
    await t
      .update(guides)
      .set({
        displayName: 'Former guide',
        avatarUrl: null,
        slug: `deleted-${guide.id.slice(0, 8)}`,
        userId: null,
        payoutStatus: 'restricted',
        deletedAt: new Date(),
      })
      .where(eq(guides.id, guide.id));
    await t.update(tours).set({ active: false }).where(eq(tours.guideId, guide.id));
    if (u) await t.delete(loginTokens).where(eq(loginTokens.email, u.email));
    await t.delete(users).where(eq(users.id, userId));
    await audit(t, { actor: `user:${userId}`, action: 'guide.deleted', entity: 'guide', entityId: guide.id });
  });
}

