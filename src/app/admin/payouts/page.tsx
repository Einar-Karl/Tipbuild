import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { guides, payouts } from '@/db/schema';
import { PayoutRunForm } from '@/components/admin/PayoutRunForm';
import { formatDate, formatDateTime } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { previousPeriod } from '@/lib/payouts';

export const dynamic = 'force-dynamic';

export default async function AdminPayouts() {
  const rows = await (await getDb())
    .select({ p: payouts, guide: guides.displayName })
    .from(payouts)
    .innerJoin(guides, eq(guides.id, payouts.guideId))
    .orderBy(desc(payouts.periodStart), desc(payouts.createdAt))
    .limit(200);
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Payouts</h1>
      <PayoutRunForm defaultPeriod={previousPeriod(new Date()).label} />
      <div className="table-wrap">
        <table className="table" data-testid="admin-payouts">
          <thead>
            <tr>
              <th>Period</th>
              <th>Guide</th>
              <th className="text-right">Amount</th>
              <th>Status</th>
              <th>Paid</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="text-muted">
                  No payouts yet.
                </td>
              </tr>
            )}
            {rows.map(({ p, guide }) => (
              <tr key={p.id}>
                <td>
                  {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                </td>
                <td>{guide}</td>
                <td className="text-right">{formatMoney(p.amountMinor, p.currency)}</td>
                <td className={p.status === 'failed' ? 'font-bold text-danger' : ''}>{p.status}</td>
                <td>{p.paidAt ? formatDateTime(p.paidAt) : '–'}</td>
                <td className="text-xs text-muted">{p.failureReason ?? p.providerPayoutId ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
