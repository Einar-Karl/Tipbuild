import { getDb } from '@/db';
import { exportPayoutRows, exportTipRows } from '@/lib/admin';
import { csvResponse } from '@/lib/csv';
import { formatDate } from '@/lib/format';
import { api, ApiError } from '@/lib/http';
import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** `?type=tips|payouts&from=YYYY-MM-DD&to=YYYY-MM-DD`. European Excel CSV (`;` and decimal comma). */
export const GET = api(async (req) => {
  const admin = await requireAdmin(req);
  const url = new URL(req.url);
  const type = url.searchParams.get('type') ?? 'tips';
  const parseDate = (k: string) => {
    const v = url.searchParams.get(k);
    if (!v) return undefined;
    const d = new Date(`${v}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) throw new ApiError(400, 'invalid_date');
    return d;
  };
  const db = await getDb();
  await audit(db, { actor: `admin:${admin.id}`, action: 'export.csv', entity: type });
  if (type === 'payouts') {
    const rows = await exportPayoutRows(db);
    return csvResponse(
      [
        ['Payout id', 'Guide', 'Period start', 'Period end', 'Currency', 'Amount', 'Status', 'Paid at', 'Provider payout id'],
        ...rows.map((r) => [r.id, r.guide, formatDate(r.periodStart), formatDate(r.periodEnd), r.currency, { money: r.amountMinor }, r.status, r.paidAt, r.providerPayoutId]),
      ],
      'payouts.csv',
    );
  }
  if (type !== 'tips') throw new ApiError(400, 'invalid_type');
  const to = parseDate('to');
  const rows = await exportTipRows(db, parseDate('from'), to ? new Date(to.getTime() + 86_400_000) : undefined);
  return csvResponse(
    [
      ['Tip id', 'Date', 'Guide', 'Tour', 'Currency', 'Gross', 'Fee', 'Net', 'Status', 'Rating', 'Country'],
      ...rows.map((r) => [
        r.id,
        r.createdAt,
        r.guide,
        r.tour,
        r.currency,
        { money: r.amountMinor },
        { money: r.feeMinor },
        { money: r.netMinor },
        r.status,
        r.rating === null ? null : { int: r.rating },
        r.country,
      ]),
    ],
    'tips.csv',
  );
});
