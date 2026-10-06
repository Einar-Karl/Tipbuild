/** All money is integer minor units (cents) plus an ISO currency code. */

export class MoneyError extends Error {}

function assertMinor(n: number, what: string): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new MoneyError(`${what} must be a non-negative integer, got ${n}`);
}

/** Service fee on an amount: basis points, rounded half up. */
export function feeFor(amountMinor: number, bps: number): number {
  assertMinor(amountMinor, 'amount');
  assertMinor(bps, 'bps');
  return Math.floor((amountMinor * bps + 5000) / 10000);
}

export interface TipSplit {
  /** What the tourist is charged. */
  amountMinor: number;
  /** Platform service fee. */
  feeMinor: number;
  /** What the guide receives. Always amountMinor - feeMinor. */
  netMinor: number;
}

/**
 * Split a chosen tip into charge / fee / net.
 * - default: tourist pays the tip, the fee is deducted from the guide's side.
 * - coverFee: tourist pays tip + fee so the guide receives the full chosen tip.
 * amount === fee + net always holds, so no minor unit is created or lost.
 */
export function splitTip(tipMinor: number, bps: number, coverFee = false): TipSplit {
  const fee = feeFor(tipMinor, bps);
  if (coverFee) return { amountMinor: tipMinor + fee, feeMinor: fee, netMinor: tipMinor };
  return { amountMinor: tipMinor, feeMinor: fee, netMinor: tipMinor - fee };
}

const fmtCache = new Map<string, Intl.NumberFormat>();
function fmt(currency: string, fractionDigits: number): Intl.NumberFormat {
  const key = `${currency}:${fractionDigits}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    fmtCache.set(key, f);
  }
  return f;
}

const ZERO_DECIMAL = new Set(['ISK', 'JPY']);

/** European formatting for every UI language: 1.234,50 € */
export function formatMoney(minor: number, currency: string): string {
  const digits = ZERO_DECIMAL.has(currency) ? 0 : 2;
  return fmt(currency, digits).format(minor / 10 ** digits);
}

/** Amount only, no symbol, e.g. "1.234,50" (used in CSV and tables). */
export function formatAmount(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${whole},${(abs % 100).toString().padStart(2, '0')}`;
}

/** Parse user input like "12,50", "12.5" or "1.234,50" into minor units. Returns null if invalid. */
export function parseMajorToMinor(input: string): number | null {
  let s = input.trim().replace(/[€\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  return Number(w) * 100 + Number(f.padEnd(2, '0'));
}

/** ISK hint shown to tourists only; never used for settlement. */
export function eurToIskHint(amountMinor: number, iskPerEur: number): number {
  return Math.round((amountMinor / 100) * iskPerEur);
}

export const MIN_TIP_MINOR = 100; // €1
export const MAX_TIP_MINOR = 50000; // €500
