import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db/types';
import { auditLog, guides, tips, webhookEvents } from '@/db/schema';
import type { AppConfig } from '@/lib/config';
import { guidePayableBalance } from '@/lib/ledger';
import { MockProvider, mockProcessorFee } from '@/lib/provider/mock';
import { WebhookSignatureError, type ProviderEvent } from '@/lib/provider/types';
import { createTip, getPublicTip, rateTip, TipError } from '@/lib/tips';
import { handleWebhook } from '@/lib/webhooks';
import { makeGuide, makeOperator, testDb } from '../helpers';

const cfg: AppConfig = {
  feeBps: 500,
  currency: 'EUR',
  fundsModel: 'psp_scheduled_payout',
  minPayoutMinor: 2000,
  assumedRateBps: 600,
  appUrl: 'http://localhost:3000',
};
const provider = new MockProvider({ secret: 'x'.repeat(40), appUrl: cfg.appUrl });

let db: Db;
beforeAll(async () => {
  db = await testDb();
});

let evn = 0;
const evId = () => `evt_${++evn}`;

async function send(ev: ProviderEvent) {
  const { rawBody, signature } = provider.deliver(ev);
  return handleWebhook(db, provider, cfg, rawBody, signature);
}

function succeeded(t: { providerPaymentId: string | null; id: string; amountMinor: number; currency: string }, id = evId()): ProviderEvent {
  return {
    id,
    type: 'payment.succeeded',
    paymentId: t.providerPaymentId!,
    tipId: t.id,
    amountMinor: t.amountMinor,
    currency: t.currency,
    processorFeeMinor: mockProcessorFee(t.amountMinor),
  };
}

async function tipFor(guideSlug: string, tipMinor = 1000, extra: Partial<Parameters<typeof createTip>[3]> = {}) {
  const created = await createTip(db, provider, cfg, { slug: guideSlug, tipMinor, ...extra });
  const [row] = await db.select().from(tips).where(eq(tips.id, created.tipId));
  return { created, row: row! };
}

describe('createTip', () => {
  it('prices the tip with the 5% fee and stores a pending tip', async () => {
    const g = await makeGuide(db);
    const { created, row } = await tipFor(g.slug, 1000);
    expect(created).toMatchObject({ amountMinor: 1000, feeMinor: 50, netMinor: 950 });
    expect(row.status).toBe('pending');
    expect(row.providerPaymentId).toBe(created.providerPaymentId);
  });

  it('cover-the-fee charges tip + fee and the guide gets the full tip', async () => {
    const g = await makeGuide(db);
    const { created } = await tipFor(g.slug, 1000, { coverFee: true });
    expect(created).toMatchObject({ amountMinor: 1050, feeMinor: 50, netMinor: 1000 });
  });

  it('applies the operator fee override', async () => {
    const op = await makeOperator(db, { feeBpsOverride: 300 });
    const g = await makeGuide(db, { operatorId: op.id });
    const { created } = await tipFor(g.slug, 1000);
    expect(created.feeMinor).toBe(30);
  });

  it('refuses inactive guides, unknown guides, bad amounts and currencies', async () => {
    const pending = await makeGuide(db, { payoutStatus: 'pending' });
    await expect(createTip(db, provider, cfg, { slug: pending.slug, tipMinor: 1000 })).rejects.toMatchObject({ code: 'guide_not_active', status: 409 });
    const noAccount = await makeGuide(db, { payoutAccountId: null });
    await expect(createTip(db, provider, cfg, { slug: noAccount.slug, tipMinor: 1000 })).rejects.toMatchObject({ code: 'guide_not_active' });
    await expect(createTip(db, provider, cfg, { slug: 'nope', tipMinor: 1000 })).rejects.toMatchObject({ code: 'guide_not_found' });
    const g = await makeGuide(db);
    for (const bad of [99, 50001, 12.5, -5]) await expect(createTip(db, provider, cfg, { slug: g.slug, tipMinor: bad })).rejects.toMatchObject({ code: 'invalid_amount' });
    await expect(createTip(db, provider, cfg, { slug: g.slug, tipMinor: 1000, currency: 'USD' })).rejects.toMatchObject({ code: 'unsupported_currency' });
    expect(await db.select().from(tips).where(eq(tips.guideId, pending.id))).toHaveLength(0);
  });

  it('rejects a tour that belongs to another guide', async () => {
    const a = await makeGuide(db);
    const b = await makeGuide(db);
    const { tours } = await import('@/db/schema');
    const [t] = await db.select().from(tours).where(eq(tours.guideId, b.id));
    await expect(createTip(db, provider, cfg, { slug: a.slug, tipMinor: 1000, tourId: t!.id })).rejects.toBeInstanceOf(TipError);
  });

  it('marks the tip failed when the provider call fails', async () => {
    const g = await makeGuide(db);
    const broken = new MockProvider({ secret: 'x'.repeat(40), appUrl: cfg.appUrl });
    broken.createTipIntent = async () => {
      throw new Error('boom');
    };
    await expect(createTip(db, broken, cfg, { slug: g.slug, tipMinor: 1000 })).rejects.toThrow('boom');
    const rows = await db.select().from(tips).where(eq(tips.guideId, g.id));
    expect(rows[0]!.status).toBe('failed');
  });
});

describe('webhooks', () => {
  it('rejects bad or missing signatures', async () => {
    const { rawBody } = provider.deliver({ id: 'x', type: 'ignored' });
    await expect(handleWebhook(db, provider, cfg, rawBody, 'deadbeef')).rejects.toBeInstanceOf(WebhookSignatureError);
    await expect(handleWebhook(db, provider, cfg, rawBody, null)).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it('credits the guide once; replaying the same event does not double-credit', async () => {
    const g = await makeGuide(db);
    const { row } = await tipFor(g.slug, 2000);
    const ev = succeeded(row);
    expect(await send(ev)).toBe('processed');
    expect(await guidePayableBalance(db, g.id, 'EUR')).toBe(1900);
    expect(await send(ev)).toBe('duplicate');
    expect(await send(ev)).toBe('duplicate');
    // a *different* event for the same payment is also a no-op
    expect(await send(succeeded(row))).toBe('ignored');
    expect(await guidePayableBalance(db, g.id, 'EUR')).toBe(1900);
    const [t] = await db.select().from(tips).where(eq(tips.id, row.id));
    expect(t!.status).toBe('succeeded');
  });

  it('refund reverses the ledger; replay is a no-op', async () => {
    const g = await makeGuide(db);
    const { row } = await tipFor(g.slug, 2000);
    await send(succeeded(row));
    const refund: ProviderEvent = { id: evId(), type: 'charge.refunded', paymentId: row.providerPaymentId!, amountRefundedMinor: 2000, currency: 'EUR' };
    expect(await send(refund)).toBe('processed');
    expect(await send(refund)).toBe('duplicate');
    expect(await send({ ...refund, id: evId() })).toBe('ignored');
    expect(await guidePayableBalance(db, g.id, 'EUR')).toBe(0);
    expect((await db.select().from(tips).where(eq(tips.id, row.id)))[0]!.status).toBe('refunded');
  });

  it('partial refunds are flagged for manual handling, not silently applied', async () => {
    const g = await makeGuide(db);
    const { row } = await tipFor(g.slug, 2000);
    await send(succeeded(row));
    await send({ id: evId(), type: 'charge.refunded', paymentId: row.providerPaymentId!, amountRefundedMinor: 500, currency: 'EUR' });
    expect(await guidePayableBalance(db, g.id, 'EUR')).toBe(1900);
    const log = await db.select().from(auditLog).where(eq(auditLog.entityId, row.id));
    expect(log.map((l) => l.action)).toContain('tip.partial_refund_needs_manual_handling');
  });

  it('records failures, does not credit on amount mismatch, and a retry of the same event can succeed', async () => {
    const g = await makeGuide(db);
    const { row } = await tipFor(g.slug, 1000);
    const bad: ProviderEvent = { ...succeeded(row), amountMinor: 1 } as ProviderEvent;
    await expect(send(bad)).rejects.toThrow(/amount mismatch/);
    expect(await guidePayableBalance(db, g.id, 'EUR')).toBe(0);
    const [w] = await db.select().from(webhookEvents).where(eq(webhookEvents.eventId, bad.id));
    expect(w!.status).toBe('failed');
    // provider redelivers the same event id with a corrected payload -> reprocessed
    expect(await send({ ...bad, amountMinor: row.amountMinor } as ProviderEvent)).toBe('processed');
    expect(await guidePayableBalance(db, g.id, 'EUR')).toBe(950);
  });

  it('payment.failed then a later success still credits (retry on the same intent)', async () => {
    const g = await makeGuide(db);
    const { row } = await tipFor(g.slug, 1000);
    await send({ id: evId(), type: 'payment.failed', paymentId: row.providerPaymentId!, tipId: row.id });
    expect((await db.select().from(tips).where(eq(tips.id, row.id)))[0]!.status).toBe('failed');
    await send(succeeded(row));
    expect(await guidePayableBalance(db, g.id, 'EUR')).toBe(950);
  });

  it('ignores payments that are not ours', async () => {
    expect(await send({ id: evId(), type: 'payment.succeeded', paymentId: 'pi_other', amountMinor: 100, currency: 'EUR' })).toBe('ignored');
  });

  it('account.updated activates the guide and sets the monthly payout schedule once', async () => {
    const g = await makeGuide(db, { payoutStatus: 'pending', payoutAccountId: 'acct_activate' });
    const spy = vi.spyOn(provider, 'setPayoutSchedule');
    await send({ id: evId(), type: 'account.updated', accountId: 'acct_activate', payoutsEnabled: true, detailsSubmitted: true });
    expect((await db.select().from(guides).where(eq(guides.id, g.id)))[0]!.payoutStatus).toBe('active');
    expect(spy).toHaveBeenCalledWith('acct_activate', { interval: 'monthly', anchor: 1 });
    await send({ id: evId(), type: 'account.updated', accountId: 'acct_activate', payoutsEnabled: false, detailsSubmitted: true });
    expect((await db.select().from(guides).where(eq(guides.id, g.id)))[0]!.payoutStatus).toBe('restricted');
    spy.mockRestore();
  });
});

describe('ratings', () => {
  it('one rating per paid tip; text can be added once; review link only for 4-5 stars', async () => {
    const op = await makeOperator(db, { reviewUrl: 'https://example.com/review' });
    const g = await makeGuide(db, { operatorId: op.id });
    const { row } = await tipFor(g.slug, 1000);
    await expect(rateTip(db, row.id, 5)).rejects.toMatchObject({ code: 'tip_not_paid' });
    await send(succeeded(row));
    expect(await rateTip(db, row.id, 5)).toEqual({ reviewUrl: 'https://example.com/review' });
    await expect(rateTip(db, row.id, 1)).rejects.toMatchObject({ code: 'already_rated' });

    const { row: row2 } = await tipFor(g.slug, 1000);
    await send(succeeded(row2));
    expect(await rateTip(db, row2.id, 2)).toEqual({ reviewUrl: null });
    await rateTip(db, row2.id, 2, 'Too fast');
    await expect(rateTip(db, row2.id, 2, 'again')).rejects.toMatchObject({ code: 'already_rated' });
    const pub = await getPublicTip(db, row2.id);
    expect(pub).toMatchObject({ rating: 2, hasFeedback: true, status: 'succeeded' });
    expect(await getPublicTip(db, 'not-a-uuid')).toBeNull();
  });
});
