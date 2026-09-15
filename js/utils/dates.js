/**
 * PMExps — Dates
 *
 * The ledger has exactly one notion of "which day a transaction belongs to":
 * `ledgerDate`, a string in `YYYY-MM-DD`, interpreted in the workspace
 * timezone (Asia/Kolkata by default). It is never a Date object and never a
 * timestamp, because a timestamp would shift across the IST boundary and
 * silently move an entry to the previous day for a user abroad.
 *
 * Separately, audit and lifecycle fields (`createdAt`, `confirmedAt`,
 * `lockedAt`) are Firestore server timestamps. Those record *when the system
 * acted*; `ledgerDate` records *which accounting day the money moved*. The two
 * are deliberately different types and must not be derived from each other.
 *
 * @module utils/dates
 */

/** Workspace default timezone. Overridable per workspace in settings. */
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/** Matches a well-formed ledger date. Does not check calendar validity. */
const LEDGER_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Thrown when a value that must be a ledger date is not one. */
export class DateError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'DateError';
    this.code = code;
  }
}

/**
 * Is this a syntactically and calendrically valid `YYYY-MM-DD` string?
 * Rejects "2026-02-30" as well as "2026-2-3".
 * @param {unknown} value
 * @returns {boolean}
 */
export function isLedgerDate(value) {
  if (typeof value !== 'string' || !LEDGER_DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Round-trip through UTC to reject impossible days without timezone drift.
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

/**
 * Assert a ledger date, returning it narrowed.
 * @param {unknown} value
 * @param {string} [field]
 * @returns {string}
 * @throws {DateError}
 */
export function assertLedgerDate(value, field = 'ledgerDate') {
  if (!isLedgerDate(value)) {
    throw new DateError(
      'date/invalid',
      `${field} must be a valid date in YYYY-MM-DD format`,
    );
  }
  return /** @type {string} */ (value);
}

/**
 * Today's ledger date in the given timezone.
 *
 * Uses Intl with an explicit timeZone rather than local clock arithmetic, so
 * a user in London at 21:00 GMT correctly gets tomorrow's IST date.
 *
 * @param {string} [timeZone]
 * @param {Date} [now] injectable for tests
 * @returns {string} YYYY-MM-DD
 */
export function todayLedgerDate(timeZone = DEFAULT_TIMEZONE, now = new Date()) {
  return toLedgerDate(now, timeZone);
}

/**
 * Convert an instant to the ledger date it falls on in a timezone.
 * @param {Date} instant
 * @param {string} [timeZone]
 * @returns {string} YYYY-MM-DD
 */
export function toLedgerDate(instant, timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);

  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Split a ledger date into its numeric parts.
 * @param {string} ledgerDate
 * @returns {{ year: number, month: number, day: number }}
 */
export function parseLedgerDate(ledgerDate) {
  assertLedgerDate(ledgerDate);
  const [year, month, day] = ledgerDate.split('-').map(Number);
  return { year, month, day };
}

/**
 * Shift a ledger date by a whole number of days. Pure calendar arithmetic —
 * no timezone involved, because both ends are already wall-clock dates.
 * @param {string} ledgerDate
 * @param {number} days may be negative
 * @returns {string}
 */
export function addDays(ledgerDate, days) {
  const { year, month, day } = parseLedgerDate(ledgerDate);
  const probe = new Date(Date.UTC(year, month - 1, day));
  probe.setUTCDate(probe.getUTCDate() + days);
  return formatUtcAsLedgerDate(probe);
}

/**
 * Shift by whole months, clamping to the end of a shorter month:
 * addMonths('2026-01-31', 1) → '2026-02-28'.
 * @param {string} ledgerDate
 * @param {number} months
 * @returns {string}
 */
export function addMonths(ledgerDate, months) {
  const { year, month, day } = parseLedgerDate(ledgerDate);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalisedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = daysInMonth(targetYear, normalisedMonth + 1);
  const probe = new Date(
    Date.UTC(targetYear, normalisedMonth, Math.min(day, lastDay)),
  );
  return formatUtcAsLedgerDate(probe);
}

/** @param {Date} utcDate @returns {string} */
function formatUtcAsLedgerDate(utcDate) {
  const y = String(utcDate.getUTCFullYear()).padStart(4, '0');
  const m = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utcDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * @param {number} year
 * @param {number} month 1-12
 * @returns {number} number of days in that month
 */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** @param {string} ledgerDate @returns {string} first day of that month */
export function startOfMonth(ledgerDate) {
  const { year, month } = parseLedgerDate(ledgerDate);
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** @param {string} ledgerDate @returns {string} last day of that month */
export function endOfMonth(ledgerDate) {
  const { year, month } = parseLedgerDate(ledgerDate);
  const last = daysInMonth(year, month);
  return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

/**
 * Whole days from `from` to `to`. Negative when `to` precedes `from`.
 * @param {string} from
 * @param {string} to
 * @returns {number}
 */
export function daysBetween(from, to) {
  const a = parseLedgerDate(from);
  const b = parseLedgerDate(to);
  const ms =
    Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86_400_000);
}

/**
 * Inclusive list of ledger dates between two bounds. Guarded so a mistyped
 * range cannot allocate an unbounded array.
 * @param {string} from
 * @param {string} to
 * @param {number} [maxDays=732] two years plus a leap day
 * @returns {string[]}
 */
export function ledgerDateRange(from, to, maxDays = 732) {
  const span = daysBetween(from, to);
  if (span < 0) {
    throw new DateError('date/range-inverted', 'Start date must be on or before end date');
  }
  if (span + 1 > maxDays) {
    throw new DateError('date/range-too-large', `Range cannot exceed ${maxDays} days`);
  }
  const out = [];
  for (let i = 0; i <= span; i += 1) out.push(addDays(from, i));
  return out;
}

/* -------------------------------------------------------------------------
   Indian financial year
   Runs 1 April → 31 March. FY label for 2026-05-10 is "2026-27"; the short
   year token used in voucher numbers is "2026" (the year the FY opens).
   ------------------------------------------------------------------------- */

/**
 * @param {string} ledgerDate
 * @returns {{ startYear: number, endYear: number, label: string, token: string,
 *             startDate: string, endDate: string }}
 */
export function financialYear(ledgerDate) {
  const { year, month } = parseLedgerDate(ledgerDate);
  const startYear = month >= 4 ? year : year - 1;
  const endYear = startYear + 1;
  return {
    startYear,
    endYear,
    label: `${startYear}-${String(endYear).slice(-2)}`,
    token: String(startYear),
    startDate: `${startYear}-04-01`,
    endDate: `${endYear}-03-31`,
  };
}

/**
 * Do two ledger dates fall in the same financial year?
 * @param {string} a @param {string} b @returns {boolean}
 */
export function sameFinancialYear(a, b) {
  return financialYear(a).token === financialYear(b).token;
}

/* -------------------------------------------------------------------------
   Display formatting
   ------------------------------------------------------------------------- */

/**
 * Human-readable ledger date. Indian convention is day-first.
 *   'short'  → 10/05/2026
 *   'medium' → 10 May 2026
 *   'long'   → Sunday, 10 May 2026
 *
 * @param {string} ledgerDate
 * @param {{ style?: 'short'|'medium'|'long', locale?: string }} [options]
 * @returns {string}
 */
export function formatLedgerDate(ledgerDate, options = {}) {
  const { style = 'medium', locale = 'en-IN' } = options;
  const { year, month, day } = parseLedgerDate(ledgerDate);
  // Midday UTC keeps the date stable under any formatter timezone.
  const probe = new Date(Date.UTC(year, month - 1, day, 12));

  /** @type {Intl.DateTimeFormatOptions} */
  const config =
    style === 'short'
      ? { day: '2-digit', month: '2-digit', year: 'numeric' }
      : style === 'long'
        ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
        : { day: 'numeric', month: 'short', year: 'numeric' };

  return new Intl.DateTimeFormat(locale, { ...config, timeZone: 'UTC' }).format(probe);
}

/**
 * Format a Firestore Timestamp (or Date) as a date-and-time string in the
 * workspace timezone — used for audit rows and "generated at" PDF footers.
 * @param {{ toDate: () => Date }|Date|null|undefined} timestamp
 * @param {{ timeZone?: string, locale?: string }} [options]
 * @returns {string} empty string when the timestamp has not resolved yet
 */
export function formatTimestamp(timestamp, options = {}) {
  const { timeZone = DEFAULT_TIMEZONE, locale = 'en-IN' } = options;
  if (!timestamp) return '';
  const date = timestamp instanceof Date ? timestamp : timestamp.toDate?.();
  if (!date) return '';

  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/**
 * Relative label for recent activity ("Today", "Yesterday", otherwise the
 * medium date). Keeps the ledger scannable without hiding the real date.
 * @param {string} ledgerDate
 * @param {{ timeZone?: string, locale?: string, today?: string }} [options]
 * @returns {string}
 */
export function formatRelativeLedgerDate(ledgerDate, options = {}) {
  const {
    timeZone = DEFAULT_TIMEZONE,
    locale = 'en-IN',
    today = todayLedgerDate(timeZone),
  } = options;

  const delta = daysBetween(today, ledgerDate);
  if (delta === 0) return 'Today';
  if (delta === -1) return 'Yesterday';
  if (delta === 1) return 'Tomorrow';
  return formatLedgerDate(ledgerDate, { style: 'medium', locale });
}

/**
 * Is this ledger date on or before the workspace lock date?
 * A null lock date means nothing is locked.
 * @param {string} ledgerDate
 * @param {string|null|undefined} lockDate
 * @returns {boolean}
 */
export function isDateLocked(ledgerDate, lockDate) {
  if (!lockDate) return false;
  assertLedgerDate(ledgerDate);
  assertLedgerDate(lockDate, 'lockDate');
  return ledgerDate <= lockDate; // lexicographic compare is safe for ISO dates
}

/**
 * Is this date too far in the future to be a plausible entry?
 * Future-dated entries are allowed (post-dated cheques), but not years ahead.
 * @param {string} ledgerDate
 * @param {{ maxDaysAhead?: number, timeZone?: string }} [options]
 * @returns {boolean}
 */
export function isImplausiblyFuture(ledgerDate, options = {}) {
  const { maxDaysAhead = 365, timeZone = DEFAULT_TIMEZONE } = options;
  return daysBetween(todayLedgerDate(timeZone), ledgerDate) > maxDaysAhead;
}
