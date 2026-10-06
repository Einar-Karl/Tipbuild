import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Db } from '@/db/types';
import { guides, ledgerAccounts, ledgerEntries, payouts, tips, tours, users } from '@/db/schema';
import { toCsv, type Cell } from './csv';
import { formatDate } from './format';
import { formatAmount, formatMoney } from './money';

export interface Statement {
  payoutId: string;
  guideName: string;
  guideEmail: string | null;
  currency: string;
  periodStart: string;
  periodEnd: string;
  tipCount: number;
  grossMinor: number;
  feeMinor: number;
  netMinor: number;
  refundsMinor: number;
  rolledInMinor: number;
  payoutMinor: number;
  status: 'pending' | 'paid' | 'failed';
  paidAt: Date | null;
  lines: { date: Date; tour: string | null; grossMinor: number; feeMinor: number; netMinor: number }[];
}

/** Everything a guide needs to understand one payout. Period = [periodStart, periodEnd + 1 day) in UTC. */
export async function buildStatement(db: Db, payoutId: string): Promise<Statement | null> {
  const rows = await db
    .select({ p: payouts, g: guides, email: users.email })
    .from(payouts)
    .innerJoin(guides, eq(guides.id, payouts.guideId))
    .leftJoin(users, eq(users.id, guides.userId))
    .where(eq(payouts.id, payoutId));
  const r = rows[0];
  if (!r) return null;
  const { p, g } = r;
  const start = new Date(`${p.periodStart}T00:00:00Z`);
  const end = new Date(new Date(`${p.periodEnd}T00:00:00Z`).getTime() + 86_400_000);

  const lines = await db
    .select({ date: tips.succeededAt, tour: tours.title, gross: tips.amountMinor, fee: tips.feeMinor, net: tips.netMinor })
    .from(tips)
    .leftJoin(tours, eq(tours.id, tips.tourId))
    .where(
      and(
        eq(tips.guideId, g.id),
        sql`${tips.status} in ('succeeded','refunded')`,
        gte(tips.succeededAt, start),
        lt(tips.succeededAt, end),
      ),
    )
    .orderBy(asc(tips.succeededAt));

  const [ref] = await db
    .select({ n: sql<string>`coalesce(sum(${ledgerEntries.debitMinor}), 0)` })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(
      and(
        eq(ledgerAccounts.kind, 'guide_payable'),
        eq(ledgerAccounts.ownerGuideId, g.id),
        eq(ledgerEntries.refType, 'tip_refund'),
        gte(ledgerEntries.createdAt, start),
        lt(ledgerEntries.createdAt, end),
      ),
    );

  const gross = lines.reduce((s, l) => s + l.gross, 0);
  const fee = lines.reduce((s, l) => s + l.fee, 0);
  const net = lines.reduce((s, l) => s + l.net, 0);
  const refunds = Number(ref?.n ?? 0);
  return {
    payoutId: p.id,
    guideName: g.displayName,
    guideEmail: r.email,
    currency: p.currency,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    tipCount: lines.length,
    grossMinor: gross,
    feeMinor: fee,
    netMinor: net,
    refundsMinor: refunds,
    rolledInMinor: Math.max(0, p.amountMinor - (net - refunds)),
    payoutMinor: p.amountMinor,
    status: p.status,
    paidAt: p.paidAt,
    lines: lines.map((l) => ({ date: l.date ?? new Date(0), tour: l.tour, grossMinor: l.gross, feeMinor: l.fee, netMinor: l.net })),
  };
}

function payoutLine(s: Statement): string {
  if (s.status === 'paid' && s.paidAt) return `Paid ${formatDate(s.paidAt)}`;
  if (s.status === 'failed') return 'Payout failed - we are looking into it';
  return 'Scheduled - paid out by our payment partner at the start of the month';
}

export function statementText(s: Statement): string {
  const m = (n: number) => formatMoney(n, s.currency);
  return [
    `Tip statement for ${s.guideName}`,
    `Period: ${formatDate(s.periodStart)} - ${formatDate(s.periodEnd)}`,
    '',
    `Tips received:        ${s.tipCount}`,
    `Gross tips:           ${m(s.grossMinor)}`,
    `Service fee:          -${m(s.feeMinor)}`,
    `Net tips:             ${m(s.netMinor)}`,
    `Refunds:              -${m(s.refundsMinor)}`,
    ...(s.rolledInMinor > 0 ? [`Rolled over earlier:   ${m(s.rolledInMinor)}`] : []),
    `Payout:               ${m(s.payoutMinor)}`,
    `Status:               ${payoutLine(s)}`,
    '',
    'The detailed list is attached as CSV (Excel, semicolon separated) and PDF.',
  ].join('\n');
}

export function statementCsv(s: Statement): string {
  const rows: Cell[][] = [
    ['Statement', s.guideName],
    ['Period start', formatDate(s.periodStart)],
    ['Period end', formatDate(s.periodEnd)],
    ['Currency', s.currency],
    ['Tips', { int: s.tipCount }],
    ['Gross', { money: s.grossMinor }],
    ['Service fee', { money: s.feeMinor }],
    ['Net', { money: s.netMinor }],
    ['Refunds', { money: s.refundsMinor }],
    ['Rolled over from earlier months', { money: s.rolledInMinor }],
    ['Payout', { money: s.payoutMinor }],
    ['Payout status', payoutLine(s)],
    [],
    ['Date', 'Tour', 'Gross', 'Fee', 'Net'],
    ...s.lines.map((l): Cell[] => [l.date, l.tour, { money: l.grossMinor }, { money: l.feeMinor }, { money: l.netMinor }]),
  ];
  return toCsv(rows);
}

export async function statementPdf(s: Statement): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  // Standard PDF fonts only cover WinAnsi: replace anything else (e.g. Icelandic þ) with a close ASCII form.
  const safe = (t: string) =>
    t
      .replace(/[þÞ]/g, (c) => (c === 'þ' ? 'th' : 'Th'))
      .replace(/[^\x20-\x7E -ÿ€]/g, '?');
  let page = doc.addPage([595, 842]);
  let y = 790;
  const line = (t: string, opts: { size?: number; bold?: boolean; x?: number } = {}) => {
    if (y < 60) {
      page = doc.addPage([595, 842]);
      y = 790;
    }
    page.drawText(safe(t), { x: opts.x ?? 50, y, size: opts.size ?? 11, font: opts.bold ? bold : font, color: rgb(0.08, 0.09, 0.1) });
    y -= (opts.size ?? 11) + 7;
  };
  const m = (n: number) => formatAmount(n);
  line('Tip - payout statement', { size: 20, bold: true });
  line(s.guideName, { size: 13 });
  line(`Period ${formatDate(s.periodStart)} - ${formatDate(s.periodEnd)}   Currency ${s.currency}`);
  y -= 10;
  const kv = (k: string, v: string, b = false) => {
    line(k, { bold: b });
    y += 18;
    page.drawText(safe(v), { x: 400, y, size: 11, font: b ? bold : font });
    y -= 18;
  };
  kv('Tips received', String(s.tipCount));
  kv('Gross tips', m(s.grossMinor));
  kv('Service fee', `-${m(s.feeMinor)}`);
  kv('Net tips', m(s.netMinor));
  kv('Refunds', `-${m(s.refundsMinor)}`);
  if (s.rolledInMinor > 0) kv('Rolled over from earlier months', m(s.rolledInMinor));
  kv('Payout', m(s.payoutMinor), true);
  line(payoutLine(s));
  y -= 14;
  line('Date', { bold: true });
  y += 18;
  page.drawText('Tour', { x: 150, y, size: 11, font: bold });
  page.drawText('Gross', { x: 380, y, size: 11, font: bold });
  page.drawText('Fee', { x: 440, y, size: 11, font: bold });
  page.drawText('Net', { x: 500, y, size: 11, font: bold });
  y -= 18;
  for (const l of s.lines) {
    if (y < 60) {
      page = doc.addPage([595, 842]);
      y = 790;
    }
    page.drawText(formatDate(l.date), { x: 50, y, size: 9, font });
    page.drawText(safe((l.tour ?? '-').slice(0, 38)), { x: 150, y, size: 9, font });
    page.drawText(m(l.grossMinor), { x: 380, y, size: 9, font });
    page.drawText(m(l.feeMinor), { x: 440, y, size: 9, font });
    page.drawText(m(l.netMinor), { x: 500, y, size: 9, font });
    y -= 14;
  }
  return doc.save();
}
