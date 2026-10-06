import { getDb } from '@/db';
import { adminSummary } from '@/lib/admin';
import { getConfig } from '@/lib/config';
import { formatDateTime } from '@/lib/format';
import { formatMoney } from '@/lib/money';

export const dynamic = 'force-dynamic';

function Stat({ label, value, note, testId }: { label: string; value: string; note?: string; testId?: string }) {
  return (
    <div className="card">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold" data-testid={testId}>
        {value}
      </p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

export default async function AdminOverview() {
  const cfg = getConfig();
  const s = await adminSummary(await getDb(), cfg.currency);
  const m = (n: number) => formatMoney(n, s.currency);
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Overview</h1>
      <p className="text-sm text-muted">
        Funds model: <code>{cfg.fundsModel}</code> · fee {cfg.feeBps / 100} %
      </p>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Totals">
        <Stat label="Tips (all time, gross)" value={m(s.allTime.grossMinor)} note={`${s.allTime.tipCount} tips`} testId="gross" />
        <Stat label="Service fees earned" value={m(s.ledger.feesEarnedMinor)} note="net of refunds" testId="fees" />
        <Stat label="Processor costs" value={m(s.ledger.processorFeesMinor)} />
        <Stat label="Fee margin" value={m(s.ledger.feeMarginMinor)} note="fees minus processor costs" />
        <Stat label="Owed to guides" value={m(s.ledger.guidePayableMinor)} testId="payable" />
        <Stat label="This month (gross)" value={m(s.thisMonth.grossMinor)} note={`${s.thisMonth.tipCount} tips`} />
        <Stat label="Guides" value={`${s.guides.active} / ${s.guides.total}`} note="active / total" />
        <Stat label="Average rating" value={s.avgRating ? `${s.avgRating.toFixed(2).replace('.', ',')} ★` : '–'} note={`${s.ratingCount} ratings`} />
      </section>

      <section aria-labelledby="runs-h" className="flex flex-col gap-3">
        <h2 id="runs-h" className="text-xl font-bold">
          Payout runs
        </h2>
        <div className="table-wrap" role="region" aria-label="Payout runs" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th>Period</th>
                <th className="text-right">Payouts</th>
                <th className="text-right">Total</th>
                <th className="text-right">Paid</th>
                <th className="text-right">Pending</th>
                <th className="text-right">Failed</th>
              </tr>
            </thead>
            <tbody>
              {s.payoutRuns.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-muted">
                    No payout runs yet.
                  </td>
                </tr>
              )}
              {s.payoutRuns.map((r) => (
                <tr key={r.period}>
                  <td>{r.period}</td>
                  <td className="text-right">{r.count}</td>
                  <td className="text-right">{m(r.total)}</td>
                  <td className="text-right">{r.paid}</td>
                  <td className="text-right">{r.pending}</td>
                  <td className={`text-right ${r.failed ? 'font-bold text-danger' : ''}`}>{r.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="wh-h" className="flex flex-col gap-3">
        <h2 id="wh-h" className="text-xl font-bold">
          Failed webhooks
        </h2>
        {s.failedWebhooks.length === 0 ? (
          <p className="text-muted">None. Failed events are retried by the provider and cleared when they succeed.</p>
        ) : (
          <div className="table-wrap" role="region" aria-label="Failed webhooks" tabIndex={0}>
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Event</th>
                  <th>Type</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {s.failedWebhooks.map((w) => (
                  <tr key={w.eventId}>
                    <td>{formatDateTime(w.receivedAt)}</td>
                    <td className="break-all">{w.eventId}</td>
                    <td>{w.type}</td>
                    <td className="text-danger">{w.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="exp-h" className="flex flex-col gap-3">
        <h2 id="exp-h" className="text-xl font-bold">
          Export (Excel, semicolon separated)
        </h2>
        <div className="flex flex-wrap gap-3">
          <a className="btn-ghost" href="/api/admin/export.csv?type=tips">
            Tips CSV
          </a>
          <a className="btn-ghost" href="/api/admin/export.csv?type=payouts">
            Payouts CSV
          </a>
        </div>
      </section>
    </main>
  );
}
