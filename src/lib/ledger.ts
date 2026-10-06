import { randomUUID } from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { Db } from '@/db/types';
import { ledgerAccounts, ledgerEntries, type AccountKind, type Tip } from '@/db/schema';

export class LedgerError extends Error {}

export interface Line {
  accountId: string;
  debit?: number;
  credit?: number;
}

export async function ensureAccount(
  db: Db,
  kind: AccountKind,
  currency: string,
  ownerGuideId: string | null = null,
): Promise<string> {
  const inserted = await db
    .insert(ledgerAccounts)
    .values({ kind, currency, ownerGuideId })
    .onConflictDoNothing()
    .returning({ id: ledgerAccounts.id });
  if (inserted[0]) return inserted[0].id;
  const rows = await db
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.kind, kind),
        eq(ledgerAccounts.currency, currency),
        ownerGuideId ? eq(ledgerAccounts.ownerGuideId, ownerGuideId) : sql`${ledgerAccounts.ownerGuideId} IS NULL`,
      ),
    );
  if (!rows[0]) throw new LedgerError(`account ${kind}/${currency} not found`);
  return rows[0].id;
}

/**
 * Post one balanced transaction (all lines in a single INSERT).
 * Call inside db.transaction() together with the business-state change it belongs to.
 */
export async function postTransaction(
  db: Db,
  args: { lines: Line[]; currency: string; refType: string; refId: string; at?: Date },
): Promise<string> {
  const { lines, currency, refType, refId, at } = args;
  if (lines.length < 2) throw new LedgerError('a transaction needs at least two lines');
  let debits = 0;
  let credits = 0;
  for (const l of lines) {
    const d = l.debit ?? 0;
    const c = l.credit ?? 0;
    if (!Number.isSafeInteger(d) || !Number.isSafeInteger(c) || d < 0 || c < 0)
      throw new LedgerError('amounts must be non-negative integers');
    if ((d > 0) === (c > 0)) throw new LedgerError('each line must have exactly one positive side');
    debits += d;
    credits += c;
  }
  if (debits !== credits) throw new LedgerError(`unbalanced transaction: debit ${debits} != credit ${credits}`);
  const txnId = randomUUID();
  await db.insert(ledgerEntries).values(
    lines.map((l) => ({
      txnId,
      accountId: l.accountId,
      debitMinor: l.debit ?? 0,
      creditMinor: l.credit ?? 0,
      currency,
      refType,
      refId,
      ...(at ? { createdAt: at } : {}),
    })),
  );
  return txnId;
}

/** credit - debit (natural balance of liability / income accounts). */
export async function creditBalance(db: Db, accountId: string, asOf?: Date): Promise<number> {
  const rows = await db
    .select({ bal: sql<string>`COALESCE(SUM(${ledgerEntries.creditMinor} - ${ledgerEntries.debitMinor}), 0)` })
    .from(ledgerEntries)
    .where(
      and(eq(ledgerEntries.accountId, accountId), asOf ? lt(ledgerEntries.createdAt, asOf) : undefined),
    );
  return Number(rows[0]?.bal ?? 0);
}

/** What the platform owes a guide (credit balance of their guide_payable account), optionally as of a cutoff. */
export async function guidePayableBalance(db: Db, guideId: string, currency: string, asOf?: Date): Promise<number> {
  const id = await ensureAccount(db, 'guide_payable', currency, guideId);
  return creditBalance(db, id, asOf);
}

/** A tip succeeded: D guest_clearing gross / C guide_payable net / C platform_fee fee. */
export async function postTipSucceeded(
  db: Db,
  tip: Pick<Tip, 'id' | 'guideId' | 'amountMinor' | 'feeMinor' | 'netMinor' | 'currency'>,
  at?: Date,
): Promise<string> {
  const clearing = await ensureAccount(db, 'guest_clearing', tip.currency);
  const payable = await ensureAccount(db, 'guide_payable', tip.currency, tip.guideId);
  const lines: Line[] = [
    { accountId: clearing, debit: tip.amountMinor },
    { accountId: payable, credit: tip.netMinor },
  ];
  if (tip.feeMinor > 0) lines.push({ accountId: await ensureAccount(db, 'platform_fee', tip.currency), credit: tip.feeMinor });
  return postTransaction(db, { lines, currency: tip.currency, refType: 'tip', refId: tip.id, at });
}

/**
 * Full refund: exact reversal of the tip posting, except that a guide's payable balance is
 * never driven negative. If the guide was already paid out, the shortfall is absorbed by the
 * platform (debited to platform_fee) and reported to the caller.
 */
export async function postTipRefund(
  db: Db,
  tip: Pick<Tip, 'id' | 'guideId' | 'amountMinor' | 'feeMinor' | 'netMinor' | 'currency'>,
): Promise<{ txnId: string; shortfallMinor: number }> {
  const clearing = await ensureAccount(db, 'guest_clearing', tip.currency);
  const payable = await ensureAccount(db, 'guide_payable', tip.currency, tip.guideId);
  const feeAcc = await ensureAccount(db, 'platform_fee', tip.currency);
  const balance = await creditBalance(db, payable);
  const take = Math.min(tip.netMinor, Math.max(balance, 0));
  const shortfall = tip.netMinor - take;
  const platformDebit = tip.feeMinor + shortfall;
  const lines: Line[] = [{ accountId: clearing, credit: tip.amountMinor }];
  if (take > 0) lines.push({ accountId: payable, debit: take });
  if (platformDebit > 0) lines.push({ accountId: feeAcc, debit: platformDebit });
  const txnId = await postTransaction(db, { lines, currency: tip.currency, refType: 'tip_refund', refId: tip.id });
  return { txnId, shortfallMinor: shortfall };
}

/** Processor fee becomes known: D processor_fee / C guest_clearing. */
export async function postProcessorFee(
  db: Db,
  args: { tipId: string; feeMinor: number; currency: string; at?: Date },
): Promise<string | null> {
  if (args.feeMinor <= 0) return null;
  const expense = await ensureAccount(db, 'processor_fee', args.currency);
  const clearing = await ensureAccount(db, 'guest_clearing', args.currency);
  return postTransaction(db, {
    lines: [
      { accountId: expense, debit: args.feeMinor },
      { accountId: clearing, credit: args.feeMinor },
    ],
    currency: args.currency,
    refType: 'processor_fee',
    refId: args.tipId,
    at: args.at,
  });
}

/** Payout: D guide_payable / C payout_clearing. */
export async function postPayout(
  db: Db,
  p: { id: string; guideId: string; amountMinor: number; currency: string; at?: Date },
): Promise<string> {
  const payable = await ensureAccount(db, 'guide_payable', p.currency, p.guideId);
  const clearing = await ensureAccount(db, 'payout_clearing', p.currency);
  return postTransaction(db, {
    lines: [
      { accountId: payable, debit: p.amountMinor },
      { accountId: clearing, credit: p.amountMinor },
    ],
    currency: p.currency,
    refType: 'payout',
    refId: p.id,
    at: p.at,
  });
}

/** Sum of all guide_payable balances = what the platform owes guides in total. */
export async function totalGuidePayable(db: Db, currency: string): Promise<number> {
  const rows = await db
    .select({ bal: sql<string>`COALESCE(SUM(${ledgerEntries.creditMinor} - ${ledgerEntries.debitMinor}), 0)` })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(and(eq(ledgerAccounts.kind, 'guide_payable'), eq(ledgerAccounts.currency, currency)));
  return Number(rows[0]?.bal ?? 0);
}
