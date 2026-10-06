import { getDb } from '@/db';
import { getConfig } from '@/lib/config';
import { floatReport } from '@/lib/float';
import { formatMoney } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function FloatPage() {
  const cfg = getConfig();
  const r = await floatReport(await getDb(), cfg);
  const m = (n: number) => formatMoney(n, r.currency);
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Float report</h1>
      <p role="note" className="rounded-xl border border-accent bg-accent/10 p-4 text-sm" data-testid="float-disclaimer">
        {r.disclaimer}
      </p>
      <section className="grid gap-4 sm:grid-cols-3" aria-label="Float">
        <div className="card">
          <p className="text-sm text-muted">Pooled balance now</p>
          <p className="text-2xl font-bold">{m(r.currentBalanceMinor)}</p>
          <p className="mt-1 text-xs text-muted">Sum owed to guides</p>
        </div>
        <div className="card">
          <p className="text-sm text-muted">Average pooled balance</p>
          <p className="text-2xl font-bold">{m(r.avgBalanceMinor)}</p>
          <p className="mt-1 text-xs text-muted">{r.lastSnapshotDate ? `up to ${r.lastSnapshotDate}` : 'no snapshots yet'}</p>
        </div>
        <div className="card">
          <p className="text-sm text-muted">Assumed annual rate</p>
          <p className="text-2xl font-bold">{(r.assumedRateBps / 100).toLocaleString('de-DE')} %</p>
          <p className="mt-1 text-xs text-muted">
            Funds model: <code>{r.fundsModel}</code>
          </p>
        </div>
      </section>
      <div className="table-wrap" role="region" aria-label="Float by month" tabIndex={0}>
        <table className="table" data-testid="float-months">
          <thead>
            <tr>
              <th>Month</th>
              <th className="text-right">Snapshots</th>
              <th className="text-right">Avg. pooled balance</th>
              <th className="text-right">Interest estimate (what-if)</th>
              <th className="text-right">Interest attributable to platform</th>
            </tr>
          </thead>
          <tbody>
            {r.months.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted">
                  No snapshots yet. The daily job (<code>/api/cron/daily-float-snapshot</code>) fills this table.
                </td>
              </tr>
            )}
            {[...r.months].reverse().map((x) => (
              <tr key={x.month}>
                <td>{x.month}</td>
                <td className="text-right">{x.snapshots}</td>
                <td className="text-right">{m(x.avgBalanceMinor)}</td>
                <td className="text-right">{m(x.hypotheticalInterestMinor)}</td>
                <td className="text-right">{m(x.accruedInterestMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted">
        Illustration: 1.000 tips per month at an average of €15, held about 15 days at 6 % gives an average balance of about €7.500 and about €37 interest per month.
        The float is small compared with the 5 % service fee: do not build the business case on it.
      </p>
    </main>
  );
}
