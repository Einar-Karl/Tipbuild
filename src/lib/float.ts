import { and, asc, gte, lte, sql } from 'drizzle-orm';
import type { Db } from '@/db/types';
import { floatSnapshots } from '@/db/schema';
import type { AppConfig } from './config';
import { totalGuidePayable } from './ledger';

export const FLOAT_DISCLAIMER =
  'Estimate only. Interest is retained only if permitted by your licence and safeguarding rules. In psp_scheduled_payout mode this is 0.';

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/** One day of interest at an annual rate in basis points, in minor units. */
export function dailyInterest(balanceMinor: number, rateBps: number): number {
  if (balanceMinor <= 0) return 0;
  return Math.round((balanceMinor * rateBps) / 10000 / 365);
}

/**
 * Daily snapshot of the money guides are owed (the "pooled" balance) and the interest it would earn.
 * `accrued` is what could belong to the platform: 0 unless FUNDS_MODEL=platform_pooled.
 * `hypothetical` is the what-if figure shown to the owner in every mode. Idempotent per day.
 */
export async function snapshotFloat(db: Db, cfg: AppConfig, date: Date = new Date()) {
  const balance = await totalGuidePayable(db, cfg.currency);
  const hypothetical = dailyInterest(balance, cfg.assumedRateBps);
  const values = {
    date: dateOnly(date),
    currency: cfg.currency,
    pooledBalanceMinor: balance,
    assumedRateBps: cfg.assumedRateBps,
    accruedInterestMinor: cfg.fundsModel === 'platform_pooled' ? hypothetical : 0,
    hypotheticalInterestMinor: hypothetical,
    fundsModel: cfg.fundsModel,
  };
  const [row] = await db
    .insert(floatSnapshots)
    .values(values)
    .onConflictDoUpdate({ target: [floatSnapshots.date, floatSnapshots.currency], set: values })
    .returning();
  return row!;
}

export interface FloatMonth {
  month: string; // YYYY-MM
  snapshots: number;
  avgBalanceMinor: number;
  accruedInterestMinor: number;
  hypotheticalInterestMinor: number;
}

export async function floatReport(db: Db, cfg: AppConfig, opts: { from?: Date; to?: Date } = {}) {
  const rows = await db
    .select()
    .from(floatSnapshots)
    .where(
      and(
        sql`${floatSnapshots.currency} = ${cfg.currency}`,
        opts.from ? gte(floatSnapshots.date, dateOnly(opts.from)) : undefined,
        opts.to ? lte(floatSnapshots.date, dateOnly(opts.to)) : undefined,
      ),
    )
    .orderBy(asc(floatSnapshots.date));

  const byMonth = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.date.slice(0, 7);
    byMonth.set(k, [...(byMonth.get(k) ?? []), r]);
  }
  const months: FloatMonth[] = [...byMonth.entries()].map(([month, rs]) => ({
    month,
    snapshots: rs.length,
    avgBalanceMinor: Math.round(rs.reduce((s, r) => s + r.pooledBalanceMinor, 0) / rs.length),
    accruedInterestMinor: rs.reduce((s, r) => s + r.accruedInterestMinor, 0),
    hypotheticalInterestMinor: rs.reduce((s, r) => s + r.hypotheticalInterestMinor, 0),
  }));
  const last = rows[rows.length - 1];
  return {
    currency: cfg.currency,
    fundsModel: cfg.fundsModel,
    assumedRateBps: cfg.assumedRateBps,
    currentBalanceMinor: await totalGuidePayable(db, cfg.currency),
    lastSnapshotDate: last?.date ?? null,
    avgBalanceMinor: rows.length ? Math.round(rows.reduce((s, r) => s + r.pooledBalanceMinor, 0) / rows.length) : 0,
    months,
    daily: rows.slice(-60).map((r) => ({ date: r.date, balanceMinor: r.pooledBalanceMinor, hypotheticalInterestMinor: r.hypotheticalInterestMinor })),
    disclaimer: FLOAT_DISCLAIMER,
  };
}

/**
 * Back-of-the-envelope model for the README / business case:
 * monthly volume x (average hold days / 30) = average pooled balance; interest = balance x rate / 12.
 */
export function estimateMonthlyInterest(args: { tipsPerMonth: number; avgTipMinor: number; avgHoldDays: number; rateBps: number }): {
  avgBalanceMinor: number;
  interestMinor: number;
} {
  const volume = args.tipsPerMonth * args.avgTipMinor;
  const avgBalanceMinor = Math.round((volume * args.avgHoldDays) / 30);
  return { avgBalanceMinor, interestMinor: Math.round((avgBalanceMinor * args.rateBps) / 10000 / 12) };
}
