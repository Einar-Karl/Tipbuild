import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/db/types';
import { guides, tips, webhookEvents } from '@/db/schema';
import { audit } from './audit';
import type { AppConfig } from './config';
import { postProcessorFee, postTipRefund, postTipSucceeded } from './ledger';
import { handlePayoutEvent } from './payouts';
import type { PaymentProvider, ProviderEvent } from './provider/types';

export type WebhookOutcome = 'processed' | 'duplicate' | 'ignored';

interface Effects {
  activatedAccountId?: string;
}

/**
 * Verify, de-duplicate (by provider event id) and apply a provider webhook.
 * Everything that changes money state happens in ONE database transaction together with
 * the dedupe marker, so a replay can never double-credit and a crash can never half-apply.
 * A failure is recorded in webhook_events (status=failed) and rethrown so the provider retries.
 */
export async function handleWebhook(
  db: Db,
  provider: PaymentProvider,
  cfg: AppConfig,
  rawBody: string,
  signature: string | null,
): Promise<WebhookOutcome> {
  const event = provider.verifyWebhook(rawBody, signature);
  return processProviderEvent(db, provider, cfg, event);
}

export async function processProviderEvent(
  db: Db,
  provider: PaymentProvider,
  cfg: AppConfig,
  event: ProviderEvent,
): Promise<WebhookOutcome> {
  if (event.type === 'ignored') return 'ignored';

  // Network call before the transaction: never hold a DB transaction open across an HTTP request.
  let processorFee: number | null = null;
  if (event.type === 'payment.succeeded') {
    processorFee = event.processorFeeMinor ?? (await provider.fetchProcessorFee?.(event.paymentId).catch(() => null)) ?? null;
  }

  const effects: Effects = {};
  let outcome: WebhookOutcome;
  try {
    outcome = await db.transaction(async (tx) => {
      const claimed = await tx
        .insert(webhookEvents)
        .values({ eventId: event.id, type: event.type, status: 'processed', processedAt: new Date() })
        .onConflictDoUpdate({
          target: webhookEvents.eventId,
          set: { status: 'processed', error: null, processedAt: new Date() },
          setWhere: eq(webhookEvents.status, 'failed'),
        })
        .returning({ id: webhookEvents.eventId });
      if (!claimed[0]) return 'duplicate';
      return applyEvent(tx as unknown as Db, cfg, event, processorFee, effects);
    });
  } catch (e) {
    await db
      .insert(webhookEvents)
      .values({ eventId: event.id, type: event.type, status: 'failed', error: String(e instanceof Error ? e.message : e).slice(0, 500) })
      .onConflictDoUpdate({
        target: webhookEvents.eventId,
        set: { status: 'failed', error: String(e instanceof Error ? e.message : e).slice(0, 500) },
        setWhere: eq(webhookEvents.status, 'failed'),
      });
    throw e;
  }

  if (effects.activatedAccountId && cfg.fundsModel === 'psp_scheduled_payout') {
    try {
      await provider.setPayoutSchedule(effects.activatedAccountId, { interval: 'monthly', anchor: 1 });
    } catch (e) {
      await audit(db, {
        actor: 'system',
        action: 'payout_schedule.failed',
        entity: 'guide',
        entityId: effects.activatedAccountId,
        meta: { error: String(e) },
      });
    }
  }
  return outcome;
}

async function applyEvent(
  tx: Db,
  cfg: AppConfig,
  event: Exclude<ProviderEvent, { type: 'ignored' }>,
  processorFee: number | null,
  effects: Effects,
): Promise<WebhookOutcome> {
  switch (event.type) {
    case 'payment.succeeded': {
      const tip = await findTip(tx, event.paymentId, event.tipId);
      if (!tip) {
        if (!event.tipId) return 'ignored'; // not one of ours
        throw new Error(`payment ${event.paymentId} references unknown tip ${event.tipId}`);
      }
      if (tip.status === 'succeeded' || tip.status === 'refunded') return 'ignored';
      if (event.amountMinor !== tip.amountMinor || event.currency.toUpperCase() !== tip.currency.toUpperCase()) {
        await audit(tx, {
          actor: 'system',
          action: 'tip.amount_mismatch',
          entity: 'tip',
          entityId: tip.id,
          meta: { expected: tip.amountMinor, got: event.amountMinor, currency: event.currency },
        });
        throw new Error(`amount mismatch for tip ${tip.id}: expected ${tip.amountMinor}, got ${event.amountMinor}`);
      }
      const updated = await tx
        .update(tips)
        .set({ status: 'succeeded', succeededAt: new Date(), providerPaymentId: event.paymentId })
        .where(and(eq(tips.id, tip.id), inArray(tips.status, ['pending', 'failed'])))
        .returning();
      const t = updated[0];
      if (!t) return 'ignored';
      await postTipSucceeded(tx, t);
      if (processorFee) await postProcessorFee(tx, { tipId: t.id, feeMinor: processorFee, currency: t.currency });
      return 'processed';
    }
    case 'payment.failed': {
      const tip = await findTip(tx, event.paymentId, event.tipId);
      if (!tip) return 'ignored';
      await tx.update(tips).set({ status: 'failed' }).where(and(eq(tips.id, tip.id), eq(tips.status, 'pending')));
      return 'processed';
    }
    case 'charge.refunded': {
      const tip = await findTip(tx, event.paymentId);
      if (!tip || tip.status !== 'succeeded') return 'ignored';
      if (event.amountRefundedMinor < tip.amountMinor) {
        await audit(tx, {
          actor: 'system',
          action: 'tip.partial_refund_needs_manual_handling',
          entity: 'tip',
          entityId: tip.id,
          meta: { refunded: event.amountRefundedMinor, amount: tip.amountMinor },
        });
        return 'ignored';
      }
      const updated = await tx
        .update(tips)
        .set({ status: 'refunded' })
        .where(and(eq(tips.id, tip.id), eq(tips.status, 'succeeded')))
        .returning();
      if (!updated[0]) return 'ignored';
      const { shortfallMinor } = await postTipRefund(tx, updated[0]);
      if (shortfallMinor > 0)
        await audit(tx, {
          actor: 'system',
          action: 'refund.shortfall_absorbed_by_platform',
          entity: 'tip',
          entityId: tip.id,
          meta: { shortfallMinor },
        });
      return 'processed';
    }
    case 'account.updated': {
      const rows = await tx.select().from(guides).where(eq(guides.payoutAccountId, event.accountId));
      const g = rows[0];
      if (!g) return 'ignored';
      let next = g.payoutStatus;
      if (event.payoutsEnabled) next = 'active';
      else if (g.payoutStatus === 'active') next = 'restricted';
      if (next !== g.payoutStatus) {
        await tx.update(guides).set({ payoutStatus: next }).where(eq(guides.id, g.id));
        await audit(tx, { actor: 'system', action: 'guide.payout_status', entity: 'guide', entityId: g.id, meta: { from: g.payoutStatus, to: next } });
        if (next === 'active') effects.activatedAccountId = event.accountId;
      }
      return 'processed';
    }
    case 'payout.paid':
    case 'payout.failed':
      return handlePayoutEvent(tx, event);
  }
}

async function findTip(tx: Db, paymentId: string, tipId?: string) {
  const byPayment = await tx.select().from(tips).where(eq(tips.providerPaymentId, paymentId)).for('update');
  if (byPayment[0]) return byPayment[0];
  if (!tipId) return null;
  const byId = await tx.select().from(tips).where(eq(tips.id, tipId)).for('update');
  return byId[0] ?? null;
}
