/**
 * Money is the foundation of every figure this application prints, so these
 * tests are deliberately paranoid about the boundaries: parsing what people
 * actually type, refusing to round silently, and grouping the Indian way.
 */
import { describe, it, expect } from 'vitest';
import {
  parseAmountToPaise,
  formatPaise,
  formatPaiseCell,
  groupIndian,
  paiseToInputString,
  paiseToWords,
  sumPaise,
  addPaise,
  subtractPaise,
  negatePaise,
  assertPaise,
  isValidPaise,
  MoneyError,
  MAX_AMOUNT_PAISE,
} from '../../js/utils/money.js';

describe('parseAmountToPaise', () => {
  it('converts whole rupees to paise', () => {
    expect(parseAmountToPaise('1250')).toBe(125000);
  });

  it('pads a single decimal place', () => {
    expect(parseAmountToPaise('1250.5')).toBe(125050);
  });

  it('accepts Indian grouping', () => {
    expect(parseAmountToPaise('1,25,000.00')).toBe(12500000);
  });

  it('accepts Western grouping too, because people paste it', () => {
    expect(parseAmountToPaise('125,000.00')).toBe(12500000);
  });

  it.each(['\u20B9 1,250', 'Rs. 1250', 'Rs 1250', 'INR 1250'])(
    'strips the currency prefix %s',
    (input) => {
      expect(parseAmountToPaise(input)).toBe(125000);
    },
  );

  it('accepts Gujarati digits from a Gujarati keyboard', () => {
    expect(parseAmountToPaise('\u0AE7\u0AE8\u0AEB\u0AE6')).toBe(125000);
  });

  it('treats a leading decimal point as sub-rupee', () => {
    expect(parseAmountToPaise('.5')).toBe(50);
    expect(parseAmountToPaise('0.05')).toBe(5);
  });

  it('returns null for blank input so "not entered" differs from zero', () => {
    expect(parseAmountToPaise('')).toBeNull();
    expect(parseAmountToPaise('   ')).toBeNull();
    expect(parseAmountToPaise(null)).toBeNull();
  });

  it('refuses to round a third decimal place away', () => {
    expect(() => parseAmountToPaise('1250.555')).toThrow(MoneyError);
    try {
      parseAmountToPaise('1250.555');
    } catch (error) {
      expect(error.code).toBe('amount/too-precise');
    }
  });

  it.each(['12a3', '1e5', '12.3.4', '--5'])('rejects malformed input %s', (bad) => {
    expect(() => parseAmountToPaise(bad)).toThrow(MoneyError);
  });

  it('rejects negatives unless explicitly allowed', () => {
    expect(() => parseAmountToPaise('-50')).toThrow(MoneyError);
    expect(parseAmountToPaise('-50', { allowNegative: true })).toBe(-5000);
  });

  it('rejects amounts beyond the stored ceiling', () => {
    expect(() => parseAmountToPaise('100000000000')).toThrow(MoneyError);
  });

  it('never produces a non-integer', () => {
    for (const input of ['0.01', '0.10', '99.99', '1.05', '10.10', '3.33']) {
      expect(Number.isInteger(parseAmountToPaise(input))).toBe(true);
    }
  });

  it('round-trips through the input-string form', () => {
    for (const paise of [1, 5, 50, 99, 100, 125050, 12500000]) {
      expect(parseAmountToPaise(paiseToInputString(paise))).toBe(paise);
    }
  });
});

describe('groupIndian', () => {
  it.each([
    [0, '0'],
    [5, '5'],
    [100, '100'],
    [1000, '1,000'],
    [12345, '12,345'],
    [123456, '1,23,456'],
    [1234567, '12,34,567'],
    [12345678, '1,23,45,678'],
    [1234567890, '1,23,45,67,890'],
  ])('groups %i as %s', (input, expected) => {
    expect(groupIndian(input)).toBe(expected);
  });

  it('matches Intl.NumberFormat en-IN, so the PDF and the UI agree', () => {
    for (const n of [999, 1000, 99999, 100000, 9999999, 123456789]) {
      expect(groupIndian(n)).toBe(new Intl.NumberFormat('en-IN').format(n));
    }
  });
});

describe('formatPaise', () => {
  it('renders the specification example', () => {
    expect(formatPaise(12500000)).toBe('\u20B91,25,000.00');
  });

  it('uses a true minus sign, outside the currency symbol', () => {
    expect(formatPaise(-12500000)).toBe('\u2212\u20B91,25,000.00');
  });

  it('shows zero rather than an empty string', () => {
    expect(formatPaise(0)).toBe('\u20B90.00');
  });

  it('can omit the symbol and the decimals', () => {
    expect(formatPaise(125000, { symbol: false })).toBe('1,250.00');
    expect(formatPaise(125000, { decimals: false })).toBe('\u20B91,250');
  });

  it('marks a positive value when asked', () => {
    expect(formatPaise(125000, { signed: true })).toBe('+\u20B91,250.00');
  });

  it('blanks a zero cell so table columns stay quiet', () => {
    expect(formatPaiseCell(0)).toBe('');
    expect(formatPaiseCell(125000)).toBe('1,250.00');
  });
});

describe('arithmetic', () => {
  it('sums without floating point drift', () => {
    // 0.1 + 0.2 in rupees is the classic float failure; in paise it is exact.
    expect(addPaise(10, 20)).toBe(30);
    expect(sumPaise([1, 2, 3, 4, 5])).toBe(15);
  });

  it('accumulates a realistic day without error', () => {
    const entries = Array.from({ length: 500 }, () => 3333);
    expect(sumPaise(entries)).toBe(1666500);
  });

  it('subtracts and negates for reversal entries', () => {
    expect(subtractPaise(50000, 12500)).toBe(37500);
    expect(negatePaise(50000)).toBe(-50000);
  });

  it('refuses a non-integer term rather than silently truncating', () => {
    expect(() => sumPaise([100, 12.5])).toThrow(MoneyError);
  });
});

describe('assertPaise', () => {
  it('rejects zero by default, because an entry must be greater than zero', () => {
    expect(() => assertPaise(0)).toThrow(MoneyError);
    expect(assertPaise(0, { allowZero: true })).toBe(0);
  });

  it.each([1.5, NaN, '100', null, undefined, Infinity])(
    'rejects %s as an amount',
    (bad) => {
      expect(isValidPaise(bad)).toBe(false);
    },
  );

  it('accepts the ceiling and rejects one paisa above it', () => {
    expect(isValidPaise(MAX_AMOUNT_PAISE)).toBe(true);
    expect(isValidPaise(MAX_AMOUNT_PAISE + 1)).toBe(false);
  });
});

describe('paiseToWords', () => {
  it.each([
    [12500000, 'Rupees One Lakh Twenty Five Thousand Only'],
    [100, 'Rupees One Only'],
    [10000050, 'Rupees One Lakh and Fifty Paise Only'],
    [150000000, 'Rupees Fifteen Lakh Only'],
    [1000000000, 'Rupees One Crore Only'],
  ])('writes %i in words', (paise, expected) => {
    expect(paiseToWords(paise)).toBe(expected);
  });
});
