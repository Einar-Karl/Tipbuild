import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '@/db/types';
import { guides, ledgerAccounts, ledgerEntries, operators, payouts, tips, tours, webhookEvents } from '@/db/schema';
import { monthStartUtc } from './guides';
import { totalGuidePayable } from './ledger';

export interface TipTotals {
  tipCount: number;
  grossMinor: number;
  feeMinor: number;
  netMinor: number;
}

async function totals(db: Db, since?: Date): Promise<TipTotals> {
  const [r] = await db
    .select({
      n: sql<number>`count(*)::int`,
      gross: sql<string>`coalesce(sum(${tips.amountMinor}), 0)`,
      fee: sql<string>`coalesce(sum(${tips.feeMinor}), 0)`,
      net: sql<string>`coalesce(sum(${tips.netMinor}), 0)`,
    })
    .from(tips)
    .where(and(eq(tips.status, 'succeeded'), since ? gte(tips.succeededAt, since) : undefined));
  return { tipCount: r?.n ?? 0, grossMinor: Number(r?.gross ?? 0), feeMinor: Number(r?.fee ?? 0), netMinor: Number(r?.net ?? 0) };
}

/** Net balance of a ledger account kind across all owners (credit - debit). */
export async function kindBalance(db: Db, kind: (typeof ledgerAccounts.kind.enumValues)[number], currency: string): Promise<number> {
  const [r] = await db
    .select({ bal: sql<string>`coalesce(sum(${ledgerEntries.creditMinor} - ${ledgerEntries.debitMinor}), 0)` })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(and(eq(ledgerAccounts.kind, kind), eq(ledgerAccounts.currency, currency)));
  return Number(r?.bal ?? 0);
}

export async function adminSummary(db: Db, currency: string, now = new Date()) {
  const [all, month] = await Promise.all([totals(db), totals(db, monthStartUtc(now))]);
  const [g] = await db
    .select({ total: sql<number>`count(*)::int`, active: sql<number>`count(*) filter (where ${guides.payoutStatus} = 'active')::int` })
    .from(guides)
    .where(sql`${guides.deletedAt} is null`);
  const [rt] = await db
    .select({ avg: sql<string | null>`avg(${tips.rating})`, n: sql<number>`count(${tips.rating})::int` })
    .from(tips)
    .where(eq(tips.status, 'succeeded'));
  const [refunds] = await db
    .select({ n: sql<number>`count(*)::int`, gross: sql<string>`coalesce(sum(${tips.amountMinor}),0)` })
    .from(tips)
    .where(eq(tips.status, 'refunded'));
  const failedWebhooks = await db.select().from(webhookEvents).where(eq(webhookEvents.status, 'failed')).orderBy(desc(webhookEvents.receivedAt)).limit(20);
  const payoutRuns = await db
    .select({
      period: sql<string>`to_char(${payouts.periodStart}, 'YYYY-MM')`,
      count: sql<number>`count(*)::int`,
      total: sql<string>`sum(${payouts.amountMinor})`,
      paid: sql<number>`count(*) filter (where ${payouts.status} = 'paid')::int`,
      pending: sql<number>`count(*) filter (where ${payouts.status} = 'pending')::int`,
      failed: sql<number>`count(*) filter (where ${payouts.status} = 'failed')::int`,
    })
    .from(payouts)
    .groupBy(sql`to_char(${payouts.periodStart}, 'YYYY-MM')`)
    .orderBy(desc(sql`to_char(${payouts.periodStart}, 'YYYY-MM')`))
    .limit(12);

  const [feeEarned, processorFees, payable] = await Promise.all([
    kindBalance(db, 'platform_fee', currency),
    kindBalance(db, 'processor_fee', currency),
    totalGuidePayable(db, currency),
  ]);

  return {
    currency,
    allTime: all,
    thisMonth: month,
    guides: { total: g?.total ?? 0, active: g?.active ?? 0 },
    avgRating: rt?.avg ? Number(rt.avg) : null,
    ratingCount: rt?.n ?? 0,
    refunded: { count: refunds?.n ?? 0, grossMinor: Number(refunds?.gross ?? 0) },
    ledger: {
      /** Service fees earned, net of refunds. */
      feesEarnedMinor: feeEarned,
      /** Payment processor costs (negative balance of an expense account). */
      processorFeesMinor: -processorFees,
      /** Fees minus processor costs. */
      feeMarginMinor: feeEarned + processorFees,
      guidePayableMinor: payable,
    },
    failedWebhooks,
    payoutRuns: payoutRuns.map((p) => ({ ...p, total: Number(p.total ?? 0) })),
  };
}

export type AdminSummary = Awaited<ReturnType<typeof adminSummary>>;

export async function exportTipRows(db: Db, from?: Date, to?: Date) {
  return db
    .select({
      id: tips.id,
      createdAt: tips.createdAt,
      guide: guides.displayName,
      tour: tours.title,
      currency: tips.currency,
      amountMinor: tips.amountMinor,
      feeMinor: tips.feeMinor,
      netMinor: tips.netMinor,
      status: tips.status,
      rating: tips.rating,
      country: tips.touristCountry,
    })
    .from(tips)
    .innerJoin(guides, eq(guides.id, tips.guideId))
    .leftJoin(tours, eq(tours.id, tips.tourId))
    .where(and(from ? gte(tips.createdAt, from) : undefined, to ? sql`${tips.createdAt} < ${to}` : undefined))
    .orderBy(desc(tips.createdAt));
}

export async function exportPayoutRows(db: Db) {
  return db
    .select({
      id: payouts.id,
      guide: guides.displayName,
      periodStart: payouts.periodStart,
      periodEnd: payouts.periodEnd,
      currency: payouts.currency,
      amountMinor: payouts.amountMinor,
      status: payouts.status,
      paidAt: payouts.paidAt,
      providerPayoutId: payouts.providerPayoutId,
    })
    .from(payouts)
    .innerJoin(guides, eq(guides.id, payouts.guideId))
    .orderBy(desc(payouts.periodStart));
}

export async function listOperators(db: Db) {
  return db.select().from(operators).orderBy(operators.name);
}
