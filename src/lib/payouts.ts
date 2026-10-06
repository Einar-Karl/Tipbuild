import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '@/db/types';
import { guides, payouts, type Guide, type Payout } from '@/db/schema';
import { audit } from './audit';
import { alertAdmins } from './alerts';
import type { AppConfig } from './config';
import { sendEmail } from './email';
import { guidePayableBalance, postPayout } from './ledger';
import { formatMoney } from './money';
import type { PaymentProvider, ProviderEvent } from './provider/types';
import { buildStatement, statementCsv, statementPdf, statementText } from './statements';

export interface Period {
  label: string; // YYYY-MM
  start: Date; // inclusive, UTC
  end: Date; // exclusive, UTC (first instant of the following month)
}

export function parsePeriod(label: string): Period {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(label);
  if (!m) throw new Error(`invalid period "${label}", expected YYYY-MM`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return { label, start: new Date(Date.UTC(y, mo, 1)), end: new Date(Date.UTC(y, mo + 1, 1)) };
}

/** The previous calendar month relative to `now` (the job runs on the 1st at 06:00 UTC). */
export function previousPeriod(now: Date): Period {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return parsePeriod(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
}

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
export const payoutKey = (guideId: string, period: string) => `payout:${guideId}:${period}`;

export type GuideOutcome =
  | 'paid'
  | 'pending' // created, provider pays out (scheduled mode)
  | 'failed'
  | 'rolled_over' // below the minimum
  | 'already_paid'
  | 'skipped';

export interface PayoutRunResult {
  period: string;
  fundsModel: AppConfig['fundsModel'];
  counts: Record<GuideOutcome, number>;
  guides: { guideId: string; outcome: GuideOutcome; amountMinor?: number; payoutId?: string; error?: string }[];
}

export interface PayoutRunOptions {
  provider: PaymentProvider;
  cfg: AppConfig;
  now?: Date;
  /** YYYY-MM; defaults to the previous calendar month. */
  period?: string;
  actor?: string;
}

/**
 * Monthly payout run. Safe to re-run: one payout per guide and month (unique idempotency key),
 * the provider call carries the same key, and ledger posting is guarded by the status transition.
 */
export async function runMonthlyPayout(db: Db, opts: PayoutRunOptions): Promise<PayoutRunResult> {
  const { provider, cfg } = opts;
  const now = opts.now ?? new Date();
  const period = opts.period ? parsePeriod(opts.period) : previousPeriod(now);
  const actor = opts.actor ?? 'system';
  const result: PayoutRunResult = {
    period: period.label,
    fundsModel: cfg.fundsModel,
    counts: { paid: 0, pending: 0, failed: 0, rolled_over: 0, already_paid: 0, skipped: 0 },
    guides: [],
  };

  const active = await db.select().from(guides).where(and(eq(guides.payoutStatus, 'active'), isNull(guides.deletedAt)));
  for (const guide of active) {
    let r: PayoutRunResult['guides'][number];
    try {
      r = await payoutOneGuide(db, guide, period, opts, now);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await audit(db, { actor, action: 'payout.error', entity: 'guide', entityId: guide.id, meta: { period: period.label, error } });
      r = { guideId: guide.id, outcome: 'failed', error };
    }
    result.counts[r.outcome] += 1;
    result.guides.push(r);
  }

  await audit(db, { actor, action: 'payout.run', entity: 'payout_run', entityId: period.label, meta: { counts: result.counts, fundsModel: cfg.fundsModel } });
  const failures = result.guides.filter((g) => g.outcome === 'failed');
  if (failures.length > 0)
    await alertAdmins(
      `${failures.length} payout(s) failed for ${period.label}`,
      failures.map((f) => `${f.guideId}: ${f.error ?? 'unknown error'}`).join('\n'),
    );
  return result;
}

async function payoutOneGuide(
  db: Db,
  guide: Guide,
  period: Period,
  opts: PayoutRunOptions,
  now: Date,
): Promise<PayoutRunResult['guides'][number]> {
  const { cfg, provider } = opts;
  const actor = opts.actor ?? 'system';
  const key = payoutKey(guide.id, period.label);
  const currency = guide.defaultCurrency;

  let [row] = await db.select().from(payouts).where(eq(payouts.idempotencyKey, key));
  if (row?.status === 'paid') return { guideId: guide.id, outcome: 'already_paid', amountMinor: row.amountMinor, payoutId: row.id };

  if (!row) {
    // Balance as of the end of the period, but never more than what is owed right now (refunds).
    const atPeriodEnd = await guidePayableBalance(db, guide.id, currency, period.end);
    const current = await guidePayableBalance(db, guide.id, currency);
    const amount = Math.min(atPeriodEnd, current);
    if (amount < cfg.minPayoutMinor) return { guideId: guide.id, outcome: 'rolled_over', amountMinor: Math.max(amount, 0) };
    const inserted = await db
      .insert(payouts)
      .values({
        guideId: guide.id,
        periodStart: dateOnly(period.start),
        periodEnd: dateOnly(new Date(period.end.getTime() - 86_400_000)),
        amountMinor: amount,
        currency,
        idempotencyKey: key,
      })
      .onConflictDoNothing()
      .returning();
    row = inserted[0] ?? (await db.select().from(payouts).where(eq(payouts.idempotencyKey, key)))[0];
    if (!row) throw new Error('payout row vanished');
    await audit(db, { actor, action: 'payout.created', entity: 'payout', entityId: row.id, meta: { amountMinor: amount, period: period.label } });
  }

  if (cfg.fundsModel === 'psp_scheduled_payout') {
    // The payment provider pays out on its monthly schedule. We record, reconcile and send the statement.
    if (row.status === 'failed') await db.update(payouts).set({ status: 'pending', failureReason: null }).where(eq(payouts.id, row.id));
    await sendStatementOnce(db, row.id);
    return { guideId: guide.id, outcome: 'pending', amountMinor: row.amountMinor, payoutId: row.id };
  }

  // platform_pooled: we move the money ourselves.
  if (!guide.payoutAccountId) {
    await markFailed(db, row, 'guide has no payout account', actor);
    return { guideId: guide.id, outcome: 'failed', amountMinor: row.amountMinor, payoutId: row.id, error: 'guide has no payout account' };
  }
  try {
    const t = await provider.transferToGuide({
      guideId: guide.id,
      destinationAccountId: guide.payoutAccountId,
      amountMinor: row.amountMinor,
      currency: row.currency,
      idempotencyKey: row.idempotencyKey,
    });
    const settled = await markPaid(db, row, t.id, now, actor);
    if (settled) await sendStatementOnce(db, row.id);
    return { guideId: guide.id, outcome: 'paid', amountMinor: row.amountMinor, payoutId: row.id };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await markFailed(db, row, error, actor);
    return { guideId: guide.id, outcome: 'failed', amountMinor: row.amountMinor, payoutId: row.id, error };
  }
}

/** pending|failed -> paid and post the ledger entries, atomically. Returns false if it was already paid. */
async function markPaid(db: Db, row: Payout, providerPayoutId: string, at: Date, actor: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const updated = await t
      .update(payouts)
      .set({ status: 'paid', paidAt: at, providerPayoutId, failureReason: null })
      .where(and(eq(payouts.id, row.id), sql`${payouts.status} <> 'paid'`))
      .returning();
    if (!updated[0]) return false;
    await postPayout(t, { id: row.id, guideId: row.guideId, amountMinor: row.amountMinor, currency: row.currency, at });
    await audit(t, { actor, action: 'payout.paid', entity: 'payout', entityId: row.id, meta: { providerPayoutId, amountMinor: row.amountMinor } });
    return true;
  });
}

async function markFailed(db: Db, row: Payout, reason: string, actor: string): Promise<void> {
  await db.update(payouts).set({ status: 'failed', failureReason: reason.slice(0, 500) }).where(and(eq(payouts.id, row.id), sql`${payouts.status} <> 'paid'`));
  await audit(db, { actor, action: 'payout.failed', entity: 'payout', entityId: row.id, meta: { reason } });
}

/** Email the statement (text + CSV + PDF) exactly once per payout. */
export async function sendStatementOnce(db: Db, payoutId: string): Promise<boolean> {
  const claimed = await db
    .update(payouts)
    .set({ statementSentAt: new Date() })
    .where(and(eq(payouts.id, payoutId), isNull(payouts.statementSentAt)))
    .returning({ id: payouts.id });
  if (!claimed[0]) return false;
  try {
    const s = await buildStatement(db, payoutId);
    if (!s?.guideEmail) return false;
    const label = `${s.periodStart.slice(0, 7)}`;
    await sendEmail({
      to: s.guideEmail,
      subject: `Your tip statement for ${label}: ${formatMoney(s.payoutMinor, s.currency)}`,
      text: statementText(s),
      attachments: [
        { filename: `tip-statement-${label}.csv`, content: Buffer.from(statementCsv(s), 'utf8') },
        { filename: `tip-statement-${label}.pdf`, content: Buffer.from(await statementPdf(s)) },
      ],
    });
    return true;
  } catch (e) {
    await db.update(payouts).set({ statementSentAt: null }).where(eq(payouts.id, payoutId)); // retry on the next run
    throw e;
  }
}

/**
 * Provider payout notifications (psp_scheduled_payout): the provider paid (or failed to pay) the guide.
 * In platform_pooled mode our own transfer is the source of truth, so these are ignored.
 */
export async function handlePayoutEvent(
  db: Db,
  cfg: AppConfig,
  event: Extract<ProviderEvent, { type: 'payout.paid' | 'payout.failed' }>,
): Promise<'processed' | 'ignored'> {
  if (cfg.fundsModel !== 'psp_scheduled_payout') return 'ignored';
  const [g] = await db.select().from(guides).where(eq(guides.payoutAccountId, event.accountId));
  if (!g) return 'ignored';

  let [row] = await db.select().from(payouts).where(eq(payouts.providerPayoutId, event.payoutId));
  if (!row) {
    [row] = await db
      .select()
      .from(payouts)
      .where(and(eq(payouts.guideId, g.id), eq(payouts.status, 'pending'), isNull(payouts.providerPayoutId)))
      .orderBy(asc(payouts.periodStart))
      .limit(1);
  }
  if (!row) {
    await audit(db, { actor: 'system', action: 'payout.unmatched', entity: 'guide', entityId: g.id, meta: { event: event.type, payoutId: event.payoutId, amountMinor: event.amountMinor } });
    return 'ignored';
  }
  if (event.amountMinor !== row.amountMinor)
    await audit(db, { actor: 'system', action: 'payout.amount_mismatch', entity: 'payout', entityId: row.id, meta: { expected: row.amountMinor, provider: event.amountMinor } });

  if (event.type === 'payout.paid') {
    await markPaid(db, row, event.payoutId, new Date(), 'provider');
    return 'processed';
  }
  await db.update(payouts).set({ status: 'failed', providerPayoutId: event.payoutId, failureReason: (event.reason ?? 'provider reported failure').slice(0, 500) }).where(and(eq(payouts.id, row.id), eq(payouts.status, 'pending')));
  await audit(db, { actor: 'provider', action: 'payout.failed', entity: 'payout', entityId: row.id, meta: { reason: event.reason } });
  await alertAdmins('Provider payout failed', `Guide ${g.id}, payout ${row.id}: ${event.reason ?? 'unknown reason'}`);
  return 'processed';
}
