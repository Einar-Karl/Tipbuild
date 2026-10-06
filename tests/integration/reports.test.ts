import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db/types';
import { auditLog, loginTokens, payouts, tips, webhookEvents } from '@/db/schema';
import type { AppConfig } from '@/lib/config';
import { dailyInterest, estimateMonthlyInterest, floatReport, snapshotFloat } from '@/lib/float';
import { postTipRefund, postTipSucceeded } from '@/lib/ledger';
import { splitTip } from '@/lib/money';
import { runMonthlyPayout } from '@/lib/payouts';
import { MockProvider } from '@/lib/provider/mock';
import { reconcile } from '@/lib/reconciliation';
import { runRetention } from '@/lib/retention';
import { makeGuide, testDb } from '../helpers';

const scheduled: AppConfig = { feeBps: 500, currency: 'EUR', fundsModel: 'psp_scheduled_payout', minPayoutMinor: 2000, assumedRateBps: 600, appUrl: 'http://x' };
const pooled: AppConfig = { ...scheduled, fundsModel: 'platform_pooled' };
const provider = new MockProvider({ secret: 'x'.repeat(40), appUrl: 'http://x' });

let db: Db;
beforeAll(async () => {
  db = await testDb();
});

async function tip(guideId: string, amount: number, at = new Date('2026-08-10T10:00:00Z')) {
  const [t] = await db.insert(tips).values({ guideId, currency: 'EUR', ...splitTip(amount, 500), status: 'succeeded', createdAt: at, succeededAt: at, providerPaymentId: `pi_${Math.random()}` }).returning();
  await postTipSucceeded(db, t!, at);
  return t!;
}

describe('float report', () => {
  it('matches the illustration in the spec (1.000 tips x EUR 15, ~15 days, 6 %) at about EUR 37 per month', () => {
    const e = estimateMonthlyInterest({ tipsPerMonth: 1000, avgTipMinor: 1500, avgHoldDays: 15, rateBps: 600 });
    expect(e.avgBalanceMinor).toBe(750000);
    expect(e.interestMinor).toBe(3750);
    expect(Math.floor(e.interestMinor / 100)).toBe(37);
    expect(dailyInterest(750000, 600)).toBe(123); // 7.500 * 6 % / 365 = 1,2329
    expect(dailyInterest(-5, 600)).toBe(0);
  });

  it('snapshots the pooled balance daily and idempotently; scheduled mode attributes 0 interest to the platform', async () => {
    const g = await makeGuide(db);
    await tip(g.id, 100000); // net 950,00
    const s1 = await snapshotFloat(db, scheduled, new Date('2026-09-10T01:00:00Z'));
    expect(s1).toMatchObject({ pooledBalanceMinor: 95000, accruedInterestMinor: 0, fundsModel: 'psp_scheduled_payout' });
    expect(s1.hypotheticalInterestMinor).toBeGreaterThan(0);
    await snapshotFloat(db, scheduled, new Date('2026-09-10T23:00:00Z')); // same day again
    const rep = await floatReport(db, scheduled);
    expect(rep.months.filter((m) => m.month === '2026-09')[0]!.snapshots).toBe(1);
    expect(rep.disclaimer).toContain('In psp_scheduled_payout mode this is 0.');
  });

  it('pooled mode accrues the interest to the platform and reports monthly averages', async () => {
    await snapshotFloat(db, pooled, new Date('2026-10-01T01:00:00Z'));
    await snapshotFloat(db, pooled, new Date('2026-10-02T01:00:00Z'));
    const rep = await floatReport(db, pooled, { from: new Date('2026-10-01T00:00:00Z') });
    const oct = rep.months.find((m) => m.month === '2026-10')!;
    expect(oct.snapshots).toBe(2);
    expect(oct.accruedInterestMinor).toBe(oct.hypotheticalInterestMinor);
    expect(oct.accruedInterestMinor).toBeGreaterThan(0);
    expect(oct.avgBalanceMinor).toBe(rep.currentBalanceMinor);
  });
});

describe('reconciliation', () => {
  it('a consistent system reconciles cleanly after tips, a refund and a payout run', async () => {
    const d = await testDb();
    const g = await makeGuide(d);
    const mk = async (amt: number, at: string) => {
      const when = new Date(at);
      const [t] = await d.insert(tips).values({ guideId: g.id, currency: 'EUR', ...splitTip(amt, 500), status: 'succeeded', createdAt: when, succeededAt: when, providerPaymentId: `pi_${Math.random()}` }).returning();
      await postTipSucceeded(d, t!, when);
      return t!;
    };
    const t1 = await mk(10000, '2026-08-10T10:00:00Z');
    await mk(10000, '2026-08-11T10:00:00Z');
    await d.update(tips).set({ status: 'refunded' }).where(eq(tips.id, t1.id));
    await postTipRefund(d, t1);
    await runMonthlyPayout(d, { provider, cfg: pooled, now: new Date('2026-09-01T06:00:00Z') });
    const r = await reconcile(d, pooled, { designatedBalanceMinor: 0 });
    expect(r.checks.filter((c) => c.status === 'fail')).toEqual([]);
    expect(r.checks.find((c) => c.id === 'payouts_ledger')!.status).toBe('ok');
    expect(r.balances.guidePayableMinor).toBe(0);
  });

  it('flags a paid tip with no ledger posting, an unposted paid payout and a payout/ledger mismatch', async () => {
    const d = await testDb();
    const g = await makeGuide(d);
    await d.insert(tips).values({ guideId: g.id, currency: 'EUR', ...splitTip(1000, 500), status: 'succeeded', providerPaymentId: 'pi_orphan' });
    await d.insert(payouts).values({ guideId: g.id, periodStart: '2026-08-01', periodEnd: '2026-08-31', amountMinor: 5000, currency: 'EUR', status: 'paid', idempotencyKey: 'k1' });
    const r = await reconcile(d, scheduled);
    expect(r.status).toBe('fail');
    const failed = r.checks.filter((c) => c.status === 'fail').map((c) => c.id);
    expect(failed).toEqual(expect.arrayContaining(['tips_ledger', 'tips_net', 'payouts_ledger', 'payouts_posted']));
  });

  it('safeguarding: pooled mode compares owed balances with the designated account', async () => {
    const d = await testDb();
    const g = await makeGuide(d);
    const [t] = await d.insert(tips).values({ guideId: g.id, currency: 'EUR', ...splitTip(10000, 500), status: 'succeeded', providerPaymentId: 'pi_sg' }).returning();
    await postTipSucceeded(d, t!);
    const get = async (designated: number | null) => (await reconcile(d, pooled, { designatedBalanceMinor: designated })).checks.find((c) => c.id === 'safeguarding')!;
    expect((await get(9500)).status).toBe('ok');
    expect((await get(100000)).status).toBe('ok');
    const short = await get(9000);
    expect(short.status).toBe('fail');
    expect(short.detail).toContain('Shortfall: 500');
    expect((await get(null)).status).toBe('warn');
    const sched = (await reconcile(d, scheduled)).checks.find((c) => c.id === 'safeguarding')!;
    expect(sched.status).toBe('n/a');
  });

  it('surfaces audit flags and failed webhooks as warnings', async () => {
    const d = await testDb();
    await d.insert(auditLog).values({ actor: 'system', action: 'refund.shortfall_absorbed_by_platform', entity: 'tip', entityId: 'x', meta: {} });
    await d.insert(webhookEvents).values({ eventId: 'evt_bad', type: 'payment.succeeded', status: 'failed', error: 'boom' });
    const r = await reconcile(d, scheduled);
    expect(r.checks.find((c) => c.id === 'flags')!.status).toBe('warn');
    expect(r.checks.find((c) => c.id === 'webhooks')!.status).toBe('warn');
    expect(r.status).toBe('warn');
  });
});

describe('retention', () => {
  it('clears old free-text feedback but keeps financial records; purges stale tokens and old webhook events', async () => {
    const d = await testDb();
    const g = await makeGuide(d);
    const old = new Date('2024-01-10T10:00:00Z');
    const now = new Date('2026-10-06T10:00:00Z');
    const [oldTip] = await d.insert(tips).values({ guideId: g.id, currency: 'EUR', ...splitTip(1000, 500), status: 'succeeded', providerPaymentId: 'pi_old', rating: 2, reviewText: 'old text', createdAt: old }).returning();
    const [newTip] = await d.insert(tips).values({ guideId: g.id, currency: 'EUR', ...splitTip(1000, 500), status: 'succeeded', providerPaymentId: 'pi_new', rating: 2, reviewText: 'new text', createdAt: new Date('2026-09-01T10:00:00Z') }).returning();
    await d.insert(loginTokens).values({ email: 'a@b.c', tokenHash: 'h1', expiresAt: new Date('2026-09-01T00:00:00Z') });
    await d.insert(webhookEvents).values([
      { eventId: 'old_ok', type: 't', status: 'processed', receivedAt: new Date('2026-01-01T00:00:00Z') },
      { eventId: 'old_failed', type: 't', status: 'failed', receivedAt: new Date('2026-01-01T00:00:00Z') },
    ]);
    const res = await runRetention(d, { now, retentionMonths: 24 });
    expect(res).toEqual({ feedbackCleared: 1, loginTokensDeleted: 1, webhookEventsDeleted: 1 });
    expect((await d.select().from(tips).where(eq(tips.id, oldTip!.id)))[0]).toMatchObject({ reviewText: null, rating: 2, amountMinor: 1000 });
    expect((await d.select().from(tips).where(eq(tips.id, newTip!.id)))[0]!.reviewText).toBe('new text');
    expect((await d.select().from(webhookEvents)).map((w) => w.eventId)).toEqual(['old_failed']);
  });
});

