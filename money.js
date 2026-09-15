/**
 * PMExps — Money
 *
 * Every monetary value in this application is an integer number of paise.
 * 1 rupee = 100 paise. ₹1,25,000.00 is stored as the integer 12500000.
 *
 * Rules enforced here and relied upon everywhere else:
 *   - No float ever holds a monetary value. Not in state, not in Firestore,
 *     not in a Cloud Function, not in a report total.
 *   - Parsing happens once, at the input boundary (parseAmountToPaise).
 *   - Formatting happens once, at the render boundary (formatPaise).
 *   - Arithmetic between those two boundaries is plain integer addition.
 *
 * Paise values are safe as JS numbers: Number.MAX_SAFE_INTEGER is
 * 9,007,199,254,740,991 paise ≈ ₹90,071,992,547,409 — far beyond any
 * plausible ledger. We still guard the boundary explicitly.
 *
 * @module utils/money
 */

/** Paise in one rupee. */
export const PAISE_PER_RUPEE = 100;

/**
 * Upper bound for a single stored amount: 99,999,999,999 paise,
 * i.e. ₹99,99,99,999.99 (just under ₹100 crore) for one entry.
 * Chosen to stay well inside safe-integer range while leaving room for
 * running totals to be summed without overflow. Firestore rules enforce
 * the same ceiling server-side.
 */
export const MAX_AMOUNT_PAISE = 99_999_999_999;

/** Thrown when a value that must be money is not valid money. */
export class MoneyError extends Error {
  /**
   * @param {string} code machine-readable code, e.g. "amount/not-integer"
   * @param {string} message human-readable detail
   */
  constructor(code, message) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}

/**
 * Assert that a value is a valid stored monetary amount in paise.
 * Use at every trust boundary: form submit, repository write, function input.
 *
 * @param {unknown} value
 * @param {{ allowZero?: boolean, allowNegative?: boolean, field?: string }} [options]
 * @returns {number} the value, narrowed to a validated integer
 * @throws {MoneyError}
 */
export function assertPaise(value, options = {}) {
  const {
    allowZero = false,
    allowNegative = false,
    field = 'amount',
  } = options;

  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new MoneyError('amount/not-a-number', `${field} must be a number`);
  }
  if (!Number.isInteger(value)) {
    throw new MoneyError(
      'amount/not-integer',
      `${field} must be an integer number of paise, received ${value}`,
    );
  }
  if (!allowNegative && value < 0) {
    throw new MoneyError('amount/negative', `${field} must not be negative`);
  }
  if (!allowZero && value === 0) {
    throw new MoneyError('amount/zero', `${field} must be greater than zero`);
  }
  if (Math.abs(value) > MAX_AMOUNT_PAISE) {
    throw new MoneyError(
      'amount/out-of-range',
      `${field} exceeds the maximum supported amount`,
    );
  }
  return value;
}

/**
 * Non-throwing validity check, for use in form validation where you want a
 * message rather than an exception.
 *
 * @param {unknown} value
 * @param {{ allowZero?: boolean, allowNegative?: boolean }} [options]
 * @returns {boolean}
 */
export function isValidPaise(value, options = {}) {
  try {
    assertPaise(value, options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse user-typed text into integer paise.
 *
 * Accepts the shapes people actually type into an Indian ledger:
 *   "1250"            → 125000
 *   "1250.5"          → 125050
 *   "1250.55"         → 125055
 *   "1,25,000.00"     → 12500000   (Indian grouping)
 *   "125,000.00"      → 12500000   (Western grouping — also accepted)
 *   "₹ 1,250"         → 125000
 *   "1250.555"        → throws; we never silently round a user's money
 *   " -50 "           → throws unless allowNegative
 *
 * Returns null for empty input so callers can distinguish "not entered yet"
 * from "entered zero".
 *
 * @param {string|number|null|undefined} input
 * @param {{ allowNegative?: boolean }} [options]
 * @returns {number|null} integer paise, or null if input is blank
 * @throws {MoneyError} when the input is present but not parseable
 */
export function parseAmountToPaise(input, options = {}) {
  const { allowNegative = false } = options;

  if (input === null || input === undefined) return null;

  // A number came in directly — treat it as rupees, but only if it is exact
  // to two decimal places. This path exists for seed data and tests, not UI.
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new MoneyError('amount/not-a-number', 'Amount is not a finite number');
    }
    return parseAmountToPaise(input.toFixed(10).replace(/0+$/, ''), options);
  }

  let raw = String(input).trim();
  if (raw === '') return null;

  // Strip a leading currency symbol ("₹", "Rs", "Rs."), all whitespace
  // (including NBSP and thin space), and grouping commas. A symbol anywhere
  // other than the front is left in place so it fails validation loudly.
  raw = raw
    .replace(/^[\s\u00A0]*(?:\u20B9|Rs\.?|INR)[\s\u00A0]*/i, '')
    .replace(/[\s\u00A0\u202F\u2009]/g, '')
    .replace(/,/g, '');

  raw = normaliseDigits(raw);

  let negative = false;
  if (raw.startsWith('-')) {
    negative = true;
    raw = raw.slice(1);
  } else if (raw.startsWith('+')) {
    raw = raw.slice(1);
  }

  if (raw === '') {
    throw new MoneyError('amount/invalid', 'Enter an amount');
  }
  if (!/^\d*(\.\d*)?$/.test(raw)) {
    throw new MoneyError('amount/invalid', 'Amount contains characters that are not digits');
  }

  const [rupeePart = '', paisePartRaw = ''] = raw.split('.');

  if (paisePartRaw.length > 2) {
    throw new MoneyError(
      'amount/too-precise',
      'Amount cannot have more than two decimal places',
    );
  }

  const rupees = rupeePart === '' ? 0 : Number(rupeePart);
  const paise = paisePartRaw === '' ? 0 : Number(paisePartRaw.padEnd(2, '0'));

  if (!Number.isSafeInteger(rupees)) {
    throw new MoneyError('amount/out-of-range', 'Amount is too large');
  }

  const total = rupees * PAISE_PER_RUPEE + paise;
  const signed = negative ? -total : total;

  if (!allowNegative && signed < 0) {
    throw new MoneyError('amount/negative', 'Amount must not be negative');
  }
  if (Math.abs(signed) > MAX_AMOUNT_PAISE) {
    throw new MoneyError('amount/out-of-range', 'Amount is too large');
  }

  return signed;
}

/**
 * Convert Gujarati (૦-૯) and Devanagari (०-९) digits to ASCII so a user
 * typing on a Gujarati keyboard can still enter an amount.
 * @param {string} s
 * @returns {string}
 */
function normaliseDigits(s) {
  return s.replace(/[\u0AE6-\u0AEF\u0966-\u096F]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const base = code >= 0x0ae6 ? 0x0ae6 : 0x0966;
    return String(code - base);
  });
}

/**
 * Format integer paise as a display string using the Indian numbering system
 * (lakh/crore grouping): 12500000 → "1,25,000.00".
 *
 * @param {number} paise integer paise
 * @param {object} [options]
 * @param {boolean} [options.symbol=true] prefix with ₹
 * @param {boolean} [options.decimals=true] show the .00 paise part
 * @param {boolean} [options.signed=false] always show + or − for non-zero
 * @param {string}  [options.locale='en-IN'] 'en-IN' or 'gu-IN'
 * @returns {string}
 */
export function formatPaise(paise, options = {}) {
  const {
    symbol = true,
    decimals = true,
    signed = false,
    locale = 'en-IN',
  } = options;

  assertPaise(paise, { allowZero: true, allowNegative: true, field: 'value' });

  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.trunc(abs / PAISE_PER_RUPEE);
  const remainder = abs % PAISE_PER_RUPEE;

  const grouped = groupIndian(rupees, locale);
  const body = decimals
    ? `${grouped}${decimalSeparator(locale)}${String(remainder).padStart(2, '0')}`
    : grouped;

  let sign = '';
  if (negative) {
    sign = '\u2212'; // U+2212 MINUS SIGN — aligns with tabular figures
  } else if (signed && paise > 0) {
    sign = '+';
  }

  // Sign sits outside the symbol: −₹500.00, not ₹−500.00.
  return `${sign}${symbol ? '\u20B9' : ''}${body}`;
}

/**
 * Format for a table cell where the sign is carried by the column, not the
 * number — returns an empty string for zero so blank cells stay blank.
 * @param {number} paise
 * @param {{ locale?: string }} [options]
 * @returns {string}
 */
export function formatPaiseCell(paise, options = {}) {
  if (paise === 0) return '';
  return formatPaise(paise, { symbol: false, decimals: true, ...options });
}

/**
 * Apply Indian lakh/crore grouping to an integer rupee value.
 * Last three digits group together, then every two digits thereafter.
 * 12345678 → "1,23,45,678"
 *
 * Intl.NumberFormat('en-IN') does this correctly in every browser we target;
 * we implement it directly as well so the PDF generator (which runs without
 * a full ICU build in some environments) produces identical output.
 *
 * @param {number} rupees non-negative integer
 * @param {string} [locale]
 * @returns {string}
 */
export function groupIndian(rupees, locale = 'en-IN') {
  const s = String(Math.trunc(Math.abs(rupees)));
  const sep = groupSeparator(locale);

  if (s.length <= 3) return s;

  const lastThree = s.slice(-3);
  const rest = s.slice(0, -3);
  const groupedRest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, sep);
  return `${groupedRest}${sep}${lastThree}`;
}

/** @param {string} locale @returns {string} */
function groupSeparator(locale) {
  return locale === 'gu-IN' ? ',' : ',';
}

/** @param {string} locale @returns {string} */
function decimalSeparator(locale) {
  return locale === 'gu-IN' ? '.' : '.';
}

/**
 * Convert integer paise to a plain decimal string suitable for an <input>
 * value or a CSV cell: 12500050 → "125000.50". No symbol, no grouping.
 * @param {number} paise
 * @returns {string}
 */
export function paiseToInputString(paise) {
  assertPaise(paise, { allowZero: true, allowNegative: true, field: 'value' });
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.trunc(abs / PAISE_PER_RUPEE);
  const remainder = String(abs % PAISE_PER_RUPEE).padStart(2, '0');
  return `${negative ? '-' : ''}${rupees}.${remainder}`;
}

/**
 * Sum a list of paise amounts. Integer addition only; validates each term so
 * a single bad value cannot poison a report total silently.
 * @param {number[]} amounts
 * @returns {number}
 */
export function sumPaise(amounts) {
  let total = 0;
  for (const amount of amounts) {
    assertPaise(amount, { allowZero: true, allowNegative: true, field: 'amount' });
    total += amount;
  }
  if (!Number.isSafeInteger(total)) {
    throw new MoneyError('amount/overflow', 'Total exceeds safe integer range');
  }
  return total;
}

/**
 * Sum one numeric field across a list of records.
 * @template T
 * @param {T[]} records
 * @param {(record: T) => number} selector
 * @returns {number}
 */
export function sumBy(records, selector) {
  return sumPaise(records.map(selector));
}

/**
 * Add amounts. Present as a named function so financial code never contains a
 * bare `a + b` on money that a reviewer has to verify by eye.
 * @param {...number} amounts
 * @returns {number}
 */
export function addPaise(...amounts) {
  return sumPaise(amounts);
}

/**
 * Subtract b from a.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function subtractPaise(a, b) {
  assertPaise(a, { allowZero: true, allowNegative: true, field: 'minuend' });
  assertPaise(b, { allowZero: true, allowNegative: true, field: 'subtrahend' });
  return a - b;
}

/**
 * Negate an amount — used to build reversal entries for corrections.
 * @param {number} paise
 * @returns {number}
 */
export function negatePaise(paise) {
  assertPaise(paise, { allowZero: true, allowNegative: true, field: 'amount' });
  return -paise;
}

/**
 * Words form of an amount, for PDF cheque-style lines: "Rupees One Lakh
 * Twenty Five Thousand Only". English only; Gujarati wording is added with
 * the localisation pass.
 * @param {number} paise
 * @returns {string}
 */
export function paiseToWords(paise) {
  assertPaise(paise, { allowZero: true, allowNegative: false, field: 'amount' });
  const rupees = Math.trunc(paise / PAISE_PER_RUPEE);
  const remainder = paise % PAISE_PER_RUPEE;

  const rupeeWords = integerToWords(rupees);
  let out = `Rupees ${rupeeWords}`;
  if (remainder > 0) {
    out += ` and ${integerToWords(remainder)} Paise`;
  }
  return `${out} Only`;
}

const ONES = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
  'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
  'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty',
  'Ninety',
];

/**
 * @param {number} n non-negative integer below 10^11
 * @returns {string}
 */
function integerToWords(n) {
  if (n === 0) return 'Zero';

  /** @type {string[]} */
  const parts = [];
  /** @type {[number, string][]} */
  const units = [
    [10_000_000, 'Crore'],
    [100_000, 'Lakh'],
    [1000, 'Thousand'],
    [100, 'Hundred'],
  ];

  let rest = n;
  for (const [value, name] of units) {
    if (rest >= value) {
      const count = Math.trunc(rest / value);
      parts.push(`${integerToWords(count)} ${name}`);
      rest %= value;
    }
  }

  if (rest > 0) {
    if (rest < 20) {
      parts.push(ONES[rest]);
    } else {
      const ten = Math.trunc(rest / 10);
      const one = rest % 10;
      parts.push(one ? `${TENS[ten]} ${ONES[one]}` : TENS[ten]);
    }
  }

  return parts.join(' ');
}
