import { getDb } from '@/db';
import { getConfig } from '@/lib/config';
import { formatMoney, parseMajorToMinor } from '@/lib/money';
import { getProvider } from '@/lib/provider';
import { reconcile, type CheckStatus } from '@/lib/reconciliation';

export const dynamic = 'force-dynamic';

const BADGE: Record<CheckStatus, string> = {
  ok: 'bg-ok/15 text-ok',
  warn: 'bg-accent/20 text-ink',
  fail: 'bg-danger/15 text-danger',
  'n/a': 'bg-line text-muted',
};

export default async function Reconciliation({ searchParams }: { searchParams: Promise<{ designated?: string }> }) {
  const cfg = getConfig();
  const { designated } = await searchParams;
  const designatedMinor = designated ? parseMajorToMinor(designated) : null;
  const r = await reconcile(await getDb(), cfg, { provider: getProvider(), designatedBalanceMinor: designatedMinor });
  const m = (n: number) => formatMoney(n, r.currency);
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Reconciliation</h1>
      <p className="text-sm text-muted">
        Funds model <code>{r.fundsModel}</code> · overall:{' '}
        <span data-testid="overall" className={`rounded-md px-2 py-0.5 font-semibold ${BADGE[r.status]}`}>
          {r.status}
        </span>
      </p>

      <section className="grid gap-4 sm:grid-cols-3" aria-label="Ledger balances">
        <div className="card">
          <p className="text-sm text-muted">Owed to guides</p>
          <p className="text-2xl font-bold">{m(r.balances.guidePayableMinor)}</p>
        </div>
        <div className="card">
          <p className="text-sm text-muted">Service fees (ledger)</p>
          <p className="text-2xl font-bold">{m(r.balances.platformFeeMinor)}</p>
        </div>
        <div className="card">
          <p className="text-sm text-muted">Paid out (payout clearing)</p>
          <p className="text-2xl font-bold">{m(r.balances.payoutClearingMinor)}</p>
        </div>
      </section>

      {r.fundsModel === 'platform_pooled' && (
        <form className="card flex flex-wrap items-end gap-3" method="get">
          <div>
            <label className="label" htmlFor="designated">
              Balance of designated safeguarding account
            </label>
            <input id="designated" name="designated" className="input" inputMode="decimal" placeholder="12.345,67" defaultValue={designated ?? ''} />
          </div>
          <button className="btn">Check</button>
        </form>
      )}

      <div className="table-wrap">
        <table className="table" data-testid="checks">
          <thead>
            <tr>
              <th>Check</th>
              <th>Status</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {r.checks.map((c) => (
              <tr key={c.id}>
                <td>{c.label}</td>
                <td>
                  <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${BADGE[c.status]}`}>{c.status}</span>
                </td>
                <td className="text-muted">{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
