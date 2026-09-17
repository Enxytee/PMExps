/**
 * PMExps — Entry validation
 *
 * One validator, used by the form (to show inline errors), by the repository
 * (as a last check before a write), and by the unit tests. Keeping it in one
 * place is what stops the form and the database disagreeing about what a
 * valid entry is.
 *
 * This is the *third* line of defence, not the first. Firestore rules reject
 * the same violations independently, so a bypassed form changes nothing.
 *
 * @module validators/entry
 */

import { assertPaise, MoneyError } from '../utils/money.js';
import { isLedgerDate, isDateLocked, isImplausiblyFuture } from '../utils/dates.js';
import { ENTRY_TYPES, PAYMENT_MODES } from '../config/constants.js';

/**
 * @typedef {object} ValidationResult
 * @property {boolean} valid
 * @property {Record<string, string>} errors keyed by field name
 */

/** Field length limits, mirrored exactly in firestore.rules. */
export const LIMITS = {
  description: { min: 1, max: 200 },
  partyName: { max: 100 },
  referenceNumber: { max: 50 },
  remarks: { max: 500 },
};

/**
 * Validate a draft entry.
 *
 * @param {Record<string, any>} entry the form values
 * @param {object} context
 * @param {any[]} context.accounts accounts in this workspace
 * @param {any[]} context.categories categories in this workspace
 * @param {string|null} [context.lockDate] workspace accounting lock date
 * @returns {ValidationResult}
 */
export function validateEntry(entry, context) {
  const { accounts = [], categories = [], lockDate = null } = context ?? {};
  /** @type {Record<string, string>} */
  const errors = {};

  // ---- Type ------------------------------------------------------------
  if (!ENTRY_TYPES.includes(entry.type)) {
    errors.type = 'Choose income or expense.';
  }

  // ---- Amount ----------------------------------------------------------
  // The form has already parsed the typed text into paise; here we only
  // confirm it is a positive integer. A zero-value entry is rejected rather
  // than quietly stored, because a zero row in a ledger is always a mistake.
  try {
    assertPaise(entry.amountPaise, { field: 'Amount' });
  } catch (error) {
    errors.amountPaise =
      error instanceof MoneyError && error.code === 'amount/zero'
        ? 'Amount must be more than zero.'
        : 'Enter a valid amount.';
  }

  // ---- Date ------------------------------------------------------------
  if (!isLedgerDate(entry.ledgerDate)) {
    errors.ledgerDate = 'Choose a valid date.';
  } else if (isDateLocked(entry.ledgerDate, lockDate)) {
    errors.ledgerDate = `That date is closed. Entries on or before ${lockDate} are locked.`;
  } else if (isImplausiblyFuture(entry.ledgerDate)) {
    errors.ledgerDate = 'That date is more than a year ahead. Check it.';
  }

  // ---- Description -----------------------------------------------------
  const description = String(entry.description ?? '').trim();
  if (description.length < LIMITS.description.min) {
    errors.description = 'Write a short description.';
  } else if (description.length > LIMITS.description.max) {
    errors.description = `Keep the description under ${LIMITS.description.max} characters.`;
  }

  // ---- Account ---------------------------------------------------------
  const account = accounts.find((a) => a.accountId === entry.accountId);
  if (!entry.accountId) {
    errors.accountId = 'Choose an account.';
  } else if (!account) {
    errors.accountId = 'That account is not in this workspace.';
  } else if (!account.isActive) {
    errors.accountId = 'That account is inactive. Choose another.';
  }

  // ---- Category --------------------------------------------------------
  // The category's type must match the entry's type. Without this check a
  // salary category could be attached to an expense and the category report
  // would silently disagree with the ledger.
  const category = categories.find((c) => c.categoryId === entry.categoryId);
  if (!entry.categoryId) {
    errors.categoryId = 'Choose a category.';
  } else if (!category) {
    errors.categoryId = 'That category is not in this workspace.';
  } else if (!category.isActive) {
    errors.categoryId = 'That category is inactive. Choose another.';
  } else if (category.type !== entry.type) {
    errors.categoryId = `That is a ${category.type} category. Choose a ${entry.type} one.`;
  }

  // ---- Payment mode ----------------------------------------------------
  if (!PAYMENT_MODES.includes(entry.paymentMode)) {
    errors.paymentMode = 'Choose a payment mode.';
  }

  // ---- Optional text ---------------------------------------------------
  if (String(entry.partyName ?? '').length > LIMITS.partyName.max) {
    errors.partyName = `Keep this under ${LIMITS.partyName.max} characters.`;
  }
  if (String(entry.referenceNumber ?? '').length > LIMITS.referenceNumber.max) {
    errors.referenceNumber = `Keep this under ${LIMITS.referenceNumber.max} characters.`;
  }
  if (String(entry.remarks ?? '').length > LIMITS.remarks.max) {
    errors.remarks = `Keep remarks under ${LIMITS.remarks.max} characters.`;
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Validate an account before saving.
 * @param {Record<string, any>} account
 * @param {{ existing?: any[], editingId?: string|null }} [context]
 * @returns {ValidationResult}
 */
export function validateAccount(account, context = {}) {
  const { existing = [], editingId = null } = context;
  /** @type {Record<string, string>} */
  const errors = {};

  const name = String(account.name ?? '').trim();
  if (name.length < 1 || name.length > 60) {
    errors.name = 'Enter a name of 1 to 60 characters.';
  } else {
    // Duplicate names make an account picker unusable and a report ambiguous.
    const clash = existing.some(
      (a) =>
        a.accountId !== editingId &&
        String(a.name).trim().toLowerCase() === name.toLowerCase(),
    );
    if (clash) errors.name = 'An account with that name already exists.';
  }

  if (!['cash', 'bank', 'upiCard', 'party'].includes(account.type)) {
    errors.type = 'Choose an account type.';
  }

  try {
    assertPaise(account.openingBalancePaise, {
      allowZero: true,
      allowNegative: true,
      field: 'Opening balance',
    });
  } catch {
    errors.openingBalancePaise = 'Enter a valid opening balance.';
  }

  if (!isLedgerDate(account.openingBalanceDate)) {
    errors.openingBalanceDate = 'Choose a valid date.';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Validate a category before saving.
 * @param {Record<string, any>} category
 * @param {{ existing?: any[], editingId?: string|null }} [context]
 * @returns {ValidationResult}
 */
export function validateCategory(category, context = {}) {
  const { existing = [], editingId = null } = context;
  /** @type {Record<string, string>} */
  const errors = {};

  const name = String(category.name ?? '').trim();
  if (name.length < 1 || name.length > 60) {
    errors.name = 'Enter a name of 1 to 60 characters.';
  } else {
    // Names must be unique within a type, not globally: "Travel" as both an
    // income and an expense category is legitimate.
    const clash = existing.some(
      (c) =>
        c.categoryId !== editingId &&
        c.type === category.type &&
        String(c.name).trim().toLowerCase() === name.toLowerCase(),
    );
    if (clash) errors.name = `A ${category.type} category with that name already exists.`;
  }

  if (!ENTRY_TYPES.includes(category.type)) {
    errors.type = 'Choose income or expense.';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
