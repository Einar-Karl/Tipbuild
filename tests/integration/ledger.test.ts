import { beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import fc from 'fast-check';
import type { Db } from '@/db/types';
import { ledgerEntries, tips } from '@/db/schema';
import {
  ensureAccount,
  guidePayableBalance,
  LedgerError,
  postPayout,
  postProcessorFee,
  postTipRefund,
  postTipSucceeded,
  postTransaction,
  totalGuidePayable,
} from '@/lib/ledger';
import { splitTip } from '@/lib/money';
import { makeGuide, testDb } from '../helpers';

let db: Db;
beforeAll(async () => {
  db = await testDb();
});

async function newTip(guideId: string, amount: number, bps = 500) {
  const s = splitTip(amount, bps);
  const [t] = await db
    .insert(tips)
    .values({ guideId, currency: 'EUR', ...s, status: 'succeeded', providerPaymentId: `pi_${Math.random()}` })
    .returning();
  return t!;
}

async function unbalancedTxns(): Promise<number> {
  const r = await db.execute(
    sql`SELECT count(*)::int AS n FROM (SELECT txn_id FROM ledger_entries GROUP BY txn_id HAVING sum(debit_minor) <> sum(credit_minor)) x`,
  );
  return (r.rows[0] as { n: number }).n;
}

describe('ledger', () => {
  it('posts a balanced tip transaction', async () => {
    const g = await makeGuide(db);
    const tip = await newTip(g.id, 1000);
    await postTipSucceeded(db, tip);
    expect(await guidePayableBalance(db, g.id, 'EUR')).toBe(950);
    expect(await unbalancedTxns()).toBe(0);
  });

  it('rejects unbalanced / malformed transactions in the app layer', async () => {
    const a = await ensureAccount(db, 'bank', 'EUR');
    const b = await ensureAccount(db, 'payout_clearing', 'EUR');
    await expect(
      postTransaction(db, { lines: [{ accountId: a, debit: 5 }, { accountId: b, credit: 4 }], currency: 'EUR', refType: 't', refId: '1' }),
    ).rejects.toThrow(LedgerError);
    await expect(
      postTransaction(db, { lines: [{ accountId: a, debit: 5 }], currency: 'EUR', refType: 't', refId: '1' }),
    ).rejects.toThrow(LedgerError);
    await expect(
      postTransaction(db, { lines: [{ accountId: a, debit: 0, credit: 0 }, { accountId: b, credit: 1 }], currency: 'EUR', refType: 't', refId: '1' }),
    ).rejects.toThrow(LedgerError);
  });

  it('database refuses an unbalanced transaction at commit', async () => {
    const a = await ensureAccount(db, 'bank', 'EUR');
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(ledgerEntries).values({ txnId: crypto.randomUUID(), accountId: a, debitMinor: 10, creditMinor: 0, currency: 'EUR', refType: 'x', refId: 'x' });
      }),
    ).rejects.toThrow();
  });

  it('is append-only', async () => {
    const g = await makeGuide(db);
    await postTipSucceeded(db, await newTip(g.id, 500));
    await expect(db.update(ledgerEntries).set({ debitMinor: 1 })).rejects.toThrow();
    await expect(db.delete(ledgerEntries)).rejects.toThrow();
  });

  it('refund reverses a tip exactly when the guide is unpaid', async () => {
    const g = await makeGuide(db);
    const tip = await newTip(g.id, 2000);
    await postTipSucceeded(db, tip);
    const r = await postTipRefund(db, tip);
    expect(r.shortfallMinor).toBe(0);
    expect(await guidePayableBalance(db, g.id, 'EUR')).toBe(0);
    expect(await unbalancedTxns()).toBe(0);
  });

  it('refund after payout never makes the guide balance negative (platform absorbs it)', async () => {
    const g = await makeGuide(db);
    const tip = await newTip(g.id, 2000);
    await postTipSucceeded(db, tip);
    await postPayout(db, { id: crypto.randomUUID(), guideId: g.id, amountMinor: 1900, currency: 'EUR' });
    const r = await postTipRefund(db, tip);
    expect(r.shortfallMinor).toBe(1900);
    expect(await guidePayableBalance(db, g.id, 'EUR')).toBe(0);
  });

  it('posts processor fees', async () => {
    const g = await makeGuide(db);
    const tip = await newTip(g.id, 1000);
    await postTipSucceeded(db, tip);
    expect(await postProcessorFee(db, { tipId: tip.id, feeMinor: 40, currency: 'EUR' })).toBeTruthy();
    expect(await postProcessorFee(db, { tipId: tip.id, feeMinor: 0, currency: 'EUR' })).toBeNull();
    expect(await unbalancedTxns()).toBe(0);
  });

  it('property: random tips/refunds/payouts keep the ledger balanced and guide balances >= 0', async () => {
    const guide = await makeGuide(db);
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            fc.record({ op: fc.constant('tip' as const), amount: fc.integer({ min: 100, max: 50000 }) }),
            fc.record({ op: fc.constant('refund' as const), pick: fc.nat() }),
            fc.record({ op: fc.constant('payout' as const), frac: fc.integer({ min: 1, max: 100 }) }),
          ),
          { minLength: 1, maxLength: 12 },
        ),
        async (ops) => {
          const live: Awaited<ReturnType<typeof newTip>>[] = [];
          for (const o of ops) {
            if (o.op === 'tip') {
              const t = await newTip(guide.id, o.amount);
              await postTipSucceeded(db, t);
              live.push(t);
            } else if (o.op === 'refund') {
              const t = live.splice(o.pick % Math.max(live.length, 1), 1)[0];
              if (t) await postTipRefund(db, t);
            } else {
              const bal = await guidePayableBalance(db, guide.id, 'EUR');
              const amt = Math.floor((bal * o.frac) / 100);
              if (amt > 0) await postPayout(db, { id: crypto.randomUUID(), guideId: guide.id, amountMinor: amt, currency: 'EUR' });
            }
            expect(await guidePayableBalance(db, guide.id, 'EUR')).toBeGreaterThanOrEqual(0);
          }
          expect(await unbalancedTxns()).toBe(0);
          expect(await totalGuidePayable(db, 'EUR')).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 25 },
    );
    const n = await db.select({ c: sql<number>`count(*)::int` }).from(tips).where(eq(tips.guideId, guide.id));
    expect(n[0]).toBeDefined();
  });
});
