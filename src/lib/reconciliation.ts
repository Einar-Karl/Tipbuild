import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/types';
import { auditLog, guides, payouts, webhookEvents } from '@/db/schema';
import { kindBalance } from './admin';
import type { AppConfig } from './config';
import type { PaymentProvider } from './provider/types';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'n/a';
export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

const num = (r: unknown, k = 'n'): number => Number((r as Record<string, unknown> | undefined)?.[k] ?? 0);
async function one(db: Db, q: ReturnType<typeof sql>): Promise<Record<string, unknown>> {
  const res = await db.execute(q);
  return (res.rows[0] ?? {}) as Record<string, unknown>;
}

/**
 * Reconciliation and safeguarding report. Read-only.
 * Key rule for platform_pooled: what we owe guides (sum of guide_payable) must be <= funds held in the designated account.
 */
export async function reconcile(
  db: Db,
  cfg: AppConfig,
  opts: { provider?: PaymentProvider; designatedBalanceMinor?: number | null } = {},
) {
  const cur = cfg.currency;
  const checks: Check[] = [];
  const add = (id: string, label: string, status: CheckStatus, detail: string) => checks.push({ id, label, status, detail });

  // 1. Double entry
  const unbalanced = num(await one(db, sql`SELECT count(*)::int AS n FROM (SELECT txn_id FROM ledger_entries GROUP BY txn_id HAVING sum(debit_minor) <> sum(credit_minor)) x`));
  const totals = await one(db, sql`SELECT coalesce(sum(debit_minor),0) AS d, coalesce(sum(credit_minor),0) AS c FROM ledger_entries WHERE currency = ${cur}`);
  const balanced = unbalanced === 0 && num(totals, 'd') === num(totals, 'c');
  add('ledger_balanced', 'Every ledger transaction balances (debits = credits)', balanced ? 'ok' : 'fail', balanced ? `Total debits = total credits = ${num(totals, 'd')}` : `${unbalanced} unbalanced transaction(s)`);

  // 2. Tips <-> ledger
  const missing = num(await one(db, sql`SELECT count(*)::int AS n FROM tips t WHERE t.status IN ('succeeded','refunded') AND NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.ref_type = 'tip' AND e.ref_id = t.id::text)`));
  const dupes = num(await one(db, sql`SELECT count(*)::int AS n FROM (SELECT ref_id FROM ledger_entries WHERE ref_type = 'tip' GROUP BY ref_id HAVING count(DISTINCT txn_id) > 1) x`));
  const refundMissing = num(await one(db, sql`SELECT count(*)::int AS n FROM tips t WHERE t.status = 'refunded' AND NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.ref_type = 'tip_refund' AND e.ref_id = t.id::text)`));
  const phantom = num(await one(db, sql`SELECT count(*)::int AS n FROM tips t WHERE t.status IN ('pending','failed') AND EXISTS (SELECT 1 FROM ledger_entries e WHERE e.ref_type = 'tip' AND e.ref_id = t.id::text)`));
  const tipProblems = missing + dupes + refundMissing + phantom;
  add('tips_ledger', 'Every paid tip is in the ledger exactly once; refunds are reversed', tipProblems === 0 ? 'ok' : 'fail', tipProblems === 0 ? 'All tips match the ledger' : `${missing} paid tip(s) without posting, ${dupes} duplicate posting(s), ${refundMissing} refund(s) not reversed, ${phantom} unpaid tip(s) posted`);

  const netCheck = await one(
    db,
    sql`SELECT (SELECT coalesce(sum(net_minor),0) FROM tips WHERE status = 'succeeded') AS tips_net,
               (SELECT coalesce(sum(e.credit_minor - e.debit_minor),0) FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
                 WHERE a.kind = 'guide_payable' AND e.ref_type IN ('tip','tip_refund') AND e.ref_id IN (SELECT id::text FROM tips WHERE status = 'succeeded')) AS ledger_net`,
  );
  const netOk = num(netCheck, 'tips_net') === num(netCheck, 'ledger_net');
  add('tips_net', 'Net amounts of paid tips equal the amounts credited to guides', netOk ? 'ok' : 'fail', `tips ${num(netCheck, 'tips_net')} vs ledger ${num(netCheck, 'ledger_net')} (minor units)`);

  // 3. Guide balances
  const negative = num(await one(db, sql`SELECT count(*)::int AS n FROM (SELECT a.id FROM ledger_accounts a JOIN ledger_entries e ON e.account_id = a.id WHERE a.kind = 'guide_payable' GROUP BY a.id HAVING sum(e.credit_minor - e.debit_minor) < 0) x`));
  add('no_negative_balances', 'No guide has a negative balance', negative === 0 ? 'ok' : 'fail', negative === 0 ? 'OK' : `${negative} guide(s) with a negative balance`);

  // 4. Payouts <-> ledger
  const paidSum = num(await one(db, sql`SELECT coalesce(sum(amount_minor),0) AS n FROM payouts WHERE status = 'paid' AND currency = ${cur}`));
  const clearing = await kindBalance(db, 'payout_clearing', cur);
  add('payouts_ledger', 'Paid payouts equal the payout clearing account', paidSum === clearing ? 'ok' : 'fail', `payouts ${paidSum} vs ledger ${clearing} (minor units)`);
  const unposted = num(await one(db, sql`SELECT count(*)::int AS n FROM payouts p WHERE p.status = 'paid' AND NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.ref_type = 'payout' AND e.ref_id = p.id::text)`));
  add('payouts_posted', 'Every paid payout is posted in the ledger', unposted === 0 ? 'ok' : 'fail', unposted === 0 ? 'OK' : `${unposted} paid payout(s) without ledger entries`);
  const failedPayouts = (await db.select({ id: payouts.id }).from(payouts).where(eq(payouts.status, 'failed'))).length;
  const stalePending = num(await one(db, sql`SELECT count(*)::int AS n FROM payouts WHERE status = 'pending' AND created_at < now() - interval '45 days'`));
  add('payouts_attention', 'Payouts needing attention', failedPayouts + stalePending === 0 ? 'ok' : 'warn', `${failedPayouts} failed, ${stalePending} pending for more than 45 days`);

  // 5. Operational signals
  const failedHooks = (await db.select({ id: webhookEvents.eventId }).from(webhookEvents).where(eq(webhookEvents.status, 'failed'))).length;
  add('webhooks', 'Failed webhook events', failedHooks === 0 ? 'ok' : 'warn', `${failedHooks} unresolved`);
  const flags = await one(
    db,
    sql`SELECT count(*) FILTER (WHERE action IN ('tip.amount_mismatch','payout.amount_mismatch'))::int AS mismatches,
               count(*) FILTER (WHERE action = 'refund.shortfall_absorbed_by_platform')::int AS shortfalls,
               count(*) FILTER (WHERE action = 'tip.partial_refund_needs_manual_handling')::int AS partials
        FROM audit_log`,
  );
  const flagged = num(flags, 'mismatches') + num(flags, 'shortfalls') + num(flags, 'partials');
  add('flags', 'Items flagged in the audit log', flagged === 0 ? 'ok' : 'warn', `${num(flags, 'mismatches')} amount mismatch(es), ${num(flags, 'shortfalls')} refund shortfall(s) absorbed by the platform, ${num(flags, 'partials')} partial refund(s) to handle manually`);

  // 6. Safeguarding
  const payable = await kindBalance(db, 'guide_payable', cur);
  let designated: number | null = opts.designatedBalanceMinor ?? null;
  let source = 'entered manually';
  if (cfg.fundsModel === 'platform_pooled') {
    if (designated === null && opts.provider?.getPlatformBalance) {
      designated = await opts.provider.getPlatformBalance(cur).catch(() => null);
      source = `reported by ${opts.provider.name}`;
    }
    if (designated === null) add('safeguarding', 'Safeguarding: guide balances <= funds in the designated account', 'warn', `Owed to guides: ${payable}. Enter the balance of the designated safeguarding account to complete this check.`);
    else add('safeguarding', 'Safeguarding: guide balances <= funds in the designated account', payable <= designated ? 'ok' : 'fail', `Owed to guides ${payable} ${payable <= designated ? '<=' : '>'} designated funds ${designated} (${source}). Shortfall: ${Math.max(payable - designated, 0)}.`);
  } else {
    add('safeguarding', 'Safeguarding: guide balances <= funds in the designated account', 'n/a', 'psp_scheduled_payout: the payment provider holds the funds; the platform holds no client money.');
  }

  const [g] = await db.select({ n: sql<number>`count(*)::int` }).from(guides);
  const audits = await db.select({ n: sql<number>`count(*)::int` }).from(auditLog);
  const status: CheckStatus = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'ok';
  return {
    generatedAt: new Date().toISOString(),
    currency: cur,
    fundsModel: cfg.fundsModel,
    status,
    checks,
    balances: {
      guestClearingMinor: -(await kindBalance(db, 'guest_clearing', cur)),
      guidePayableMinor: payable,
      platformFeeMinor: await kindBalance(db, 'platform_fee', cur),
      processorFeeMinor: -(await kindBalance(db, 'processor_fee', cur)),
      payoutClearingMinor: clearing,
    },
    safeguarding: { owedToGuidesMinor: payable, designatedBalanceMinor: designated },
    counts: { guides: g?.n ?? 0, auditEntries: audits[0]?.n ?? 0 },
  };
}

export type ReconciliationReport = Awaited<ReturnType<typeof reconcile>>;
