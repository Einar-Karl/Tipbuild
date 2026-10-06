import { formatDateTime } from './format';
import { formatAmount } from './money';

/** Cell types: text is escaped and neutralised against spreadsheet formula injection. */
export type Cell = string | null | { money: number } | { int: number } | Date;

const BOM = '﻿';

function text(s: string): string {
  // CSV/formula injection: a text cell must never start a formula in Excel.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function cell(c: Cell): string {
  if (c === null) return '';
  if (c instanceof Date) return formatDateTime(c); // dd.mm.yyyy hh:mm
  if (typeof c === 'string') return text(c);
  if ('money' in c) return formatAmount(c.money); // 1.234,50
  return String(c.int);
}

/**
 * European Excel CSV: `;` as separator, `,` as decimal mark, UTF-8 with BOM so Excel opens it correctly.
 */
export function toCsv(rows: Cell[][]): string {
  return BOM + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

export function csvResponse(rows: Cell[][], filename: string): Response {
  return new Response(toCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
