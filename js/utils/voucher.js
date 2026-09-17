/**
 * PMExps — Voucher numbers
 *
 * Format: `INC-2026-00001`
 *   prefix   INC | EXP | TRF | COR
 *   year     the financial year's opening year (2026 means FY 2026-27)
 *   sequence five digits, unique within workspace + prefix + financial year
 *
 * The sequence is never chosen by the browser. It comes from a counter
 * document that may only ever increase by one, inside the same transaction
 * that confirms the entry. Firestore rules check that the number written here
 * matches the counter's post-transaction value, so a tampered client cannot
 * invent a number, reuse one, or skip ahead.
 *
 * @module utils/voucher
 */

import { VOUCHER_PREFIX, VOUCHER_SEQUENCE_WIDTH } from '../config/constants.js';
import { financialYear } from './dates.js';

/** Thrown when a voucher number is malformed. */
export class VoucherError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'VoucherError';
    this.code = code;
  }
}

/**
 * Build a voucher number.
 * @param {string} prefix e.g. 'INC'
 * @param {string} yearToken e.g. '2026'
 * @param {number} sequence 1-based
 * @returns {string}
 */
export function formatVoucher(prefix, yearToken, sequence) {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new VoucherError('voucher/invalid-sequence', 'Sequence must be a positive integer.');
  }
  if (sequence > 10 ** VOUCHER_SEQUENCE_WIDTH - 1) {
    throw new VoucherError(
      'voucher/sequence-exhausted',
      `More than ${10 ** VOUCHER_SEQUENCE_WIDTH - 1} vouchers in one financial year.`,
    );
  }
  return `${prefix}-${yearToken}-${String(sequence).padStart(VOUCHER_SEQUENCE_WIDTH, '0')}`;
}

/**
 * The prefix for an entry type or document kind.
 * @param {'income'|'expense'|'transfer'|'correction'} kind
 * @returns {string}
 */
export function prefixFor(kind) {
  const prefix = VOUCHER_PREFIX[kind];
  if (!prefix) throw new VoucherError('voucher/unknown-kind', `No voucher prefix for "${kind}".`);
  return prefix;
}

/**
 * The counter document ID for a kind and date: `INC-2026`.
 *
 * One counter per prefix per financial year is what makes numbering restart
 * at 00001 each April without any scheduled job — the new year simply has no
 * counter yet, and the first confirmation creates it.
 *
 * @param {'income'|'expense'|'transfer'|'correction'} kind
 * @param {string} ledgerDate
 * @returns {{counterId: string, prefix: string, yearToken: string}}
 */
export function counterFor(kind, ledgerDate) {
  const prefix = prefixFor(kind);
  const yearToken = financialYear(ledgerDate).token;
  return { counterId: `${prefix}-${yearToken}`, prefix, yearToken };
}

/**
 * Parse a voucher number back into its parts.
 * @param {string} voucherNumber
 * @returns {{prefix: string, yearToken: string, sequence: number}}
 */
export function parseVoucher(voucherNumber) {
  const match = String(voucherNumber ?? '').match(/^([A-Z]{3})-(\d{4})-(\d{5})$/);
  if (!match) {
    throw new VoucherError('voucher/malformed', `"${voucherNumber}" is not a voucher number.`);
  }
  return {
    prefix: match[1],
    yearToken: match[2],
    sequence: Number(match[3]),
  };
}

/** @param {string} value @returns {boolean} */
export function isVoucherNumber(value) {
  return /^[A-Z]{3}-\d{4}-\d{5}$/.test(String(value ?? ''));
}
