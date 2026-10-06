import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db/types';
import { auditLog, guides, ledgerAccounts, payouts, tips } from '@/db/schema';
import type { AppConfig } from '@/lib/config';
import { clearOutbox, getOutbox } from '@/lib/email';
import { guidePayableBalance, postTipSucceeded } from '@/lib/ledger';
import { handlePayoutEvent, parsePeriod, previousPeriod, runMonthlyPayout } from '@/lib/payouts';
import { MockProvider } from '@/lib/provider/mock';
import { splitTip } from '@/lib/money';
import { buildStatement, statementCsv, statementPdf } from '@/lib/statements';
import { creditBalance } from '@/lib/ledger';
import { makeGuide, testDb } from '../helpers';

const scheduled: AppConfig = { feeBps: 500, currency: 'EUR', fundsModel: 'psp_scheduled_payout', minPayoutMinor: 2000, assumedRateBps: 600, appUrl: 'http://x' };
const pooled: AppConfig = { ...scheduled, fundsModel: 'platform_pooled' };
const provider = new MockProvider({ secret: 'x'.repeat(40), appUrl: 'http://x' });
const NOW = new Date('2026-09-01T06:00:00Z');

let db: Db;
beforeAll(async () => {
  db = await testDb();
});
beforeEach(() => clearOutbox());

async function tipAt(guideId: string, amount: number, at: string) {
  const when = new Date(at);
  const [t] = await db
    .insert(tips)
    .values({ guideId, currency: 'EUR', ...splitTip(amount, 500), status: 'succeeded', createdAt: when, succeededAt: when, providerPaymentId: `pi_${Math.random()}` })
    .returning();
  await postTipSucceeded(db, t!, when);
  return t!;
}

async function payoutRows(guideId: string) {
  return db.select().from(payouts).where(eq(payouts.guideId, guideId));
}

describe('periods', () => {
  it('previous calendar month, including year wrap', () => {
    expect(previousPeriod(new Date('2026-09-01T06:00:00Z')).label).toBe('2026-08');
    expect(previousPeriod(new Date('2027-01-01T06:00:00Z')).label).toBe('2026-12');
    const p = parsePeriod('2026-02');
    expect(p.end.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(() => parsePeriod('2026-13')).toThrow();
  });
});

describe('monthly payout - psp_scheduled_payout', () => {
  it('one payout per eligible guide; below-minimum rolls over; inactive guides skipped; re-run is a no-op', async () => {
    const big = await makeGuide(db);
    const small = await makeGuide(db);
    const inactive = await makeGuide(db, { payoutStatus: 'pending' });
    await tipAt(big.id, 10000, '2026-08-10T10:00:00Z');
    await tipAt(big.id, 5000, '2026-08-20T10:00:00Z');
    await tipAt(small.id, 1000, '2026-08-15T10:00:00Z'); // net 9,50 < 20
    // after the period end: must NOT be included in the August payout
    await tipAt(big.id, 4000, '2026-09-01T03:00:00Z');

    const r1 = await runMonthlyPayout(db, { provider, cfg: scheduled, now: NOW });
    expect(r1.period).toBe('2026-08');
    const mine = (id: string) => r1.guides.find((g) => g.guideId === id);
    expect(mine(big.id)).toMatchObject({ outcome: 'pending', amountMinor: 9500 + 4750 });
    expect(mine(small.id)).toMatchObject({ outcome: 'rolled_over' });
    expect(mine(inactive.id)).toBeUndefined();

    expect(await payoutRows(big.id)).toHaveLength(1);
    expect(await payoutRows(small.id)).toHaveLength(0);

    const outboxAfterFirst = getOutbox().length;
    const r2 = await runMonthlyPayout(db, { provider, cfg: scheduled, now: NOW });
    expect(r2.guides.find((g) => g.guideId === big.id)?.outcome).toBe('pending');
    expect(await payoutRows(big.id)).toHaveLength(1);
    expect(getOutbox().length).toBe(outboxAfterFirst); // statement sent exactly once
  });

  it('emails a statement with CSV and PDF attachments', async () => {
    const g = await makeGuide(db);
    await tipAt(g.id, 10000, '2026-08-10T10:00:00Z');
    await runMonthlyPayout(db, { provider, cfg: scheduled, now: NOW });
    const mail = getOutbox().find((m) => m.subject.includes('2026-08') && m.text.includes(g.displayName));
    expect(mail).toBeDefined();
    expect(mail!.text).toContain('Tips received:        1');
    expect(mail!.attachments?.map((a) => a.filename)).toEqual(['tip-statement-2026-08.csv', 'tip-statement-2026-08.pdf']);
    expect(mail!.attachments![1]!.content.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('provider payout.paid marks the payout paid and posts the ledger once; replays and mismatches are handled', async () => {
    const g = await makeGuide(db, { payoutAccountId: 'acct_paid_1' });
    await tipAt(g.id, 10000, '2026-08-10T10:00:00Z');
    await runMonthlyPayout(db, { provider, cfg: scheduled, now: NOW });
    const [row] = await payoutRows(g.id);
    expect(row!.status).toBe('pending');
    expect(await guidePayableBalance(db, g.id, 'EUR')).toBe(9500);

    const ev = { id: 'e1', type: 'payout.paid', accountId: 'acct_paid_1', payoutId: 'po_1', amountMinor: 9400, currency: 'eur' } as const;
    expect(await handlePayoutEvent(db, scheduled, ev)).toBe('processed');
    expect(await guidePayableBalance(db, g.id, 'EUR')).toBe(0);
    expect((await payoutRows(g.id))[0]).toMatchObject({ status: 'paid', providerPayoutId: 'po_1' });
    // same payout again: matches by provider id, already paid, no second ledger posting
    await handlePayoutEvent(db, scheduled, ev);
    expect(await guidePayableBalance(db, g.id, 'EUR')).toBe(0);
    const log = await db.select().from(auditLog).where(eq(auditLog.entityId, row!.id));
    expect(log.map((l) => l.action)).toContain('payout.amount_mismatch');
  });

  it('provider payout.failed marks the payout failed and a re-run puts it back to pending', async () => {
    const g = await makeGuide(db, { payoutAccountId: 'acct_fail_1' });
    await tipAt(g.id, 10000, '2026-08-10T10:00:00Z');
    await runMonthlyPayout(db, { provider, cfg: scheduled, now: NOW });
    await handlePayoutEvent(db, scheduled, { id: 'e2', type: 'payout.failed', accountId: 'acct_fail_1', payoutId: 'po_f', amountMinor: 9500, currency: 'eur', reason: 'account closed' });
    expect((await payoutRows(g.id))[0]).toMatchObject({ status: 'failed', failureReason: 'account closed' });
    expect(await guidePayableBalance(db, g.id, 'EUR')).toBe(9500);
    const r = await runMonthlyPayout(db, { provider, cfg: scheduled, now: NOW });
    expect(r.guides.find((x) => x.guideId === g.id)?.outcome).toBe('pending');
  });

  it('ignores provider payouts in pooled mode and unknown accounts', async () => {
    expect(await handlePayoutEvent(db, pooled, { id: 'x', type: 'payout.paid', accountId: 'acct_x', payoutId: 'p', amountMinor: 1, currency: 'eur' })).toBe('ignored');
    expect(await handlePayoutEvent(db, scheduled, { id: 'x', type: 'payout.paid', accountId: 'acct_unknown', payoutId: 'p', amountMinor: 1, currency: 'eur' })).toBe('ignored');
  });
});

describe('monthly payout - platform_pooled', () => {
  it('transfers once, posts the ledger, and never double-pays on re-run', async () => {
    const g = await makeGuide(db);
    await tipAt(g.id, 10000, '2026-08-10T10:00:00Z');
    const spy = vi.spyOn(provider, 'transferToGuide');
    const r1 = await runMonthlyPayout(db, { provider, cfg: pooled, now: NOW });
    expect(r1.guides.find((x) => x.guideId === g.id)).toMatchObject({ outcome: 'paid', amountMinor: 9500 });
    expect(await guidePayableBalance(db, g.id, 'EUR')).toBe(0);
    const [clearing] = await db.select().from(ledgerAccounts).where(and(eq(ledgerAccounts.kind, 'payout_clearing'), eq(ledgerAccounts.currency, 'EUR')));
    expect(await creditBalance(db, clearing!.id)).toBeGreaterThanOrEqual(9500);

    const r2 = await runMonthlyPayout(db, { provider, cfg: pooled, now: NOW });
    expect(r2.guides.find((x) => x.guideId === g.id)?.outcome).toBe('already_paid');
    const calls = spy.mock.calls.filter((c) => c[0].guideId === g.id);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0].idempotencyKey).toBe(`payout:${g.id}:2026-08`);
    spy.mockRestore();
  });

  it('records a failed transfer, alerts, leaves the balance intact, and succeeds on retry with the same key', async () => {
    const g = await makeGuide(db);
    await tipAt(g.id, 10000, '2026-08-10T10:00:00Z');
    const broken = new MockProvider({ secret: 'x'.repeat(40), appUrl: 'http://x', failTransfers: true });
    const r1 = await runMonthlyPayout(db, { provider: broken, cfg: pooled, now: NOW });
    expect(r1.guides.find((x) => x.guideId === g.id)).toMatchObject({ outcome: 'failed', error: 'mock transfer failure' });
    expect((await payoutRows(g.id))[0]!.status).toBe('failed');
    expect(await guidePayableBalance(db, g.id, 'EUR')).toBe(9500);

    const r2 = await runMonthlyPayout(db, { provider, cfg: pooled, now: NOW });
    expect(r2.guides.find((x) => x.guideId === g.id)?.outcome).toBe('paid');
    expect(await payoutRows(g.id)).toHaveLength(1);
    expect(await guidePayableBalance(db, g.id, 'EUR')).toBe(0);
  });

  it('rolls small balances over and pays them with the next month', async () => {
    const g = await makeGuide(db);
    await tipAt(g.id, 1500, '2026-08-10T10:00:00Z'); // 14,25
    const aug = await runMonthlyPayout(db, { provider, cfg: pooled, now: NOW, period: '2026-08' });
    expect(aug.guides.find((x) => x.guideId === g.id)?.outcome).toBe('rolled_over');
    await tipAt(g.id, 1500, '2026-09-10T10:00:00Z'); // + 14,25 = 28,50
    const sep = await runMonthlyPayout(db, { provider, cfg: pooled, now: new Date('2026-10-01T06:00:00Z') });
    expect(sep.guides.find((x) => x.guideId === g.id)).toMatchObject({ outcome: 'paid', amountMinor: 2850 });
  });

  it('a refund between period end and the run reduces the payout (never pays money that was refunded)', async () => {
    const g = await makeGuide(db);
    const t = await tipAt(g.id, 10000, '2026-08-10T10:00:00Z');
    await tipAt(g.id, 10000, '2026-08-11T10:00:00Z');
    const { postTipRefund } = await import('@/lib/ledger');
    await postTipRefund(db, t);
    const r = await runMonthlyPayout(db, { provider, cfg: pooled, now: NOW });
    expect(r.guides.find((x) => x.guideId === g.id)).toMatchObject({ outcome: 'paid', amountMinor: 9500 });
  });
});

describe('statements', () => {
  it('computes the period figures and renders European CSV and a PDF', async () => {
    const g = await makeGuide(db, { displayName: '=HYPERLINK("x")' });
    await tipAt(g.id, 123400, '2026-08-05T10:00:00Z');
    await tipAt(g.id, 2000, '2026-08-06T10:00:00Z');
    await runMonthlyPayout(db, { provider, cfg: scheduled, now: NOW });
    const [p] = await payoutRows(g.id);
    const s = (await buildStatement(db, p!.id))!;
    expect(s).toMatchObject({ tipCount: 2, grossMinor: 125400, feeMinor: 6270, netMinor: 119130, refundsMinor: 0, payoutMinor: 119130, rolledInMinor: 0 });
    const csv = statementCsv(s);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Gross;1.254,00');
    expect(csv).toContain('Payout;1.191,30');
    expect(csv).toContain('Statement;"\'=HYPERLINK(""x"")"'); // formula injection neutralised
    expect(csv).toContain('05.08.2026 10:00;;1.234,00;61,70;1.172,30'); // dd.mm.yyyy, decimal comma
    expect(csv.split('\r\n')[0]).toMatch(/^﻿Statement;/);
    const pdf = await statementPdf(s);
    expect(Buffer.from(pdf.subarray(0, 4)).toString()).toBe('%PDF');
  });
});

describe('uniqueness', () => {
  it('the database itself refuses a second payout for the same guide and month', async () => {
    const g = await makeGuide(db);
    const row = { guideId: g.id, periodStart: '2026-08-01', periodEnd: '2026-08-31', amountMinor: 5000, currency: 'EUR', idempotencyKey: `payout:${g.id}:2026-08` };
    await db.insert(payouts).values(row);
    await expect(db.insert(payouts).values(row)).rejects.toThrow();
    expect(await db.select().from(guides).where(eq(guides.id, g.id))).toHaveLength(1);
  });
});
