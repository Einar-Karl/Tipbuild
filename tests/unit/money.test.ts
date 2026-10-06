import { describe, expect, it } from 'vitest';
import { feeFor, formatAmount, formatMoney, parseMajorToMinor, splitTip } from '@/lib/money';

describe('fee math', () => {
  it('rounds half up', () => {
    expect(feeFor(1000, 500)).toBe(50);
    expect(feeFor(110, 500)).toBe(6); // 5.5 -> 6
    expect(feeFor(109, 500)).toBe(5); // 5.45 -> 5
    expect(feeFor(100, 50)).toBe(1); // 0.5 -> 1
    expect(feeFor(0, 500)).toBe(0);
  });

  it('never creates or loses a minor unit (amount = fee + net)', () => {
    for (let amount = 100; amount <= 50000; amount += 7) {
      for (const bps of [0, 1, 250, 500, 999, 3000]) {
        for (const cover of [false, true]) {
          const s = splitTip(amount, bps, cover);
          expect(s.feeMinor + s.netMinor).toBe(s.amountMinor);
          expect(s.netMinor).toBeGreaterThanOrEqual(0);
          if (cover) expect(s.netMinor).toBe(amount);
          else expect(s.amountMinor).toBe(amount);
        }
      }
    }
  });

  it('rejects invalid input', () => {
    expect(() => feeFor(-1, 500)).toThrow();
    expect(() => feeFor(1.5, 500)).toThrow();
  });
});

describe('European formatting', () => {
  it('formats with period thousands and comma decimals', () => {
    expect(formatAmount(123450)).toBe('1.234,50');
    expect(formatAmount(5)).toBe('0,05');
    expect(formatAmount(-250)).toBe('-2,50');
    expect(formatMoney(123450, 'EUR').replace(/\s/g, ' ')).toBe('1.234,50 €');
    expect(formatMoney(1500, 'ISK')).toContain('1.500');
  });
  it('parses user input', () => {
    expect(parseMajorToMinor('12,50')).toBe(1250);
    expect(parseMajorToMinor('12.5')).toBe(1250);
    expect(parseMajorToMinor('1.234,50')).toBe(123450);
    expect(parseMajorToMinor('€ 7')).toBe(700);
    expect(parseMajorToMinor('abc')).toBeNull();
    expect(parseMajorToMinor('1,234')).toBeNull();
  });
});
