import { isNull } from 'drizzle-orm';
import { getDb } from '@/db';
import { guides } from '@/db/schema';
import { GuideOperatorSelect, OperatorForm } from '@/components/admin/OperatorForms';
import { listOperators } from '@/lib/admin';
import { getConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

export default async function AdminOperators() {
  const db = await getDb();
  const [ops, gs] = await Promise.all([listOperators(db), db.select().from(guides).where(isNull(guides.deletedAt)).orderBy(guides.displayName)]);
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Operators</h1>
      <p className="text-sm text-muted">
        Tour companies own several guides. A fee override (basis points, 500 = 5 %) replaces the default of {getConfig().feeBps} bps for their guides.
        Changes are written to the audit log.
      </p>
      <div className="flex flex-col gap-3">
        {ops.map((o) => (
          <OperatorForm key={o.id} op={o} />
        ))}
        <OperatorForm />
      </div>
      <h2 className="text-xl font-bold">Guides</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Guide</th>
              <th>Slug</th>
              <th>Payouts</th>
              <th>Operator</th>
            </tr>
          </thead>
          <tbody>
            {gs.map((g) => (
              <tr key={g.id}>
                <td>{g.displayName}</td>
                <td>{g.slug}</td>
                <td>{g.payoutStatus}</td>
                <td>
                  <GuideOperatorSelect guideId={g.id} operatorId={g.operatorId} operators={ops.map((o) => ({ id: o.id, name: o.name }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
