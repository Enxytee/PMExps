/**
 * PMExps — Balance calculations
 *
 * Every figure the app displays is computed here, from ledger entries, using
 * integer paise only. There is no stored balance to drift out of step with
 * the entries behind it: if the ledger says something, the dashboard says the
 * same thing, because they are the same arithmetic.
 *
 * The formula from the specification:
 *
 *   Closing = Opening + Confirmed income + Transfer in
 *                     − Confirmed expense − Transfer out
 *
 * Drafts are excluded everywhere. A draft that affected a balance would make
 * "confirmed" meaningless.
 *
 * @module calculations/balances
 */

import { sumBy, subtractPaise } from '../utils/money.js';
import { ENTRY_TYPE, BALANCE_AFFECTING_STATUSES } from '../config/constants.js';

/**
 * Does this entry count toward confirmed balances?
 *
 * Transfer legs are excluded from income and expense totals but included in
 * account balances — moving money between your own accounts is not income,
 * yet it certainly changes what is in each account.
 *
 * @param {Record<string, any>} entry
 * @returns {boolean}
 */
export function countsTowardBalance(entry) {
  return BALANCE_AFFECTING_STATUSES.includes(entry.status);
}

/** @param {Record<string, any>} entry @returns {boolean} */
export function isTransferLeg(entry) {
  return Boolean(entry.transferId);
}

/**
 * Income and expense totals for a set of entries.
 *
 * Transfer legs are deliberately left out: including them would inflate both
 * income and expense by the same amount and make every category report wrong.
 *
 * @param {Array<Record<string, any>>} entries
 * @returns {{incomePaise: number, expensePaise: number, netPaise: number,
 *   incomeCount: number, expenseCount: number}}
 */
export function summariseEntries(entries) {
  const counted = entries.filter((e) => countsTowardBalance(e) && !isTransferLeg(e));

  const income = counted.filter((e) => e.type === ENTRY_TYPE.INCOME);
  const expense = counted.filter((e) => e.type === ENTRY_TYPE.EXPENSE);

  // Reversals subtract from their own total rather than adding to the other
  // one, for the same reason as in accountEffect().
  const signed = (e) => (e.reversalOf ? -e.amountPaise : e.amountPaise);
  const incomePaise = sumBy(income, signed);
  const expensePaise = sumBy(expense, signed);

  return {
    incomePaise,
    expensePaise,
    netPaise: subtractPaise(incomePaise, expensePaise),
    incomeCount: income.length,
    expenseCount: expense.length,
  };
}

/**
 * Totals for entries still in draft, reported separately so a screen can show
 * "not yet counted" without ever mixing them into a confirmed figure.
 * @param {Array<Record<string, any>>} entries
 * @returns {{incomePaise: number, expensePaise: number, netPaise: number, count: number}}
 */
export function summariseDrafts(entries) {
  const drafts = entries.filter((e) => e.status === 'draft');
  const incomePaise = sumBy(drafts.filter((e) => e.type === ENTRY_TYPE.INCOME), (e) => e.amountPaise);
  const expensePaise = sumBy(drafts.filter((e) => e.type === ENTRY_TYPE.EXPENSE), (e) => e.amountPaise);
  return {
    incomePaise,
    expensePaise,
    netPaise: subtractPaise(incomePaise, expensePaise),
    count: drafts.length,
  };
}

/**
 * The effect one entry has on the balance of the account it names.
 *
 * Income adds, expense subtracts, and a transfer leg follows its direction.
 * Returning a signed number here means callers never have to remember the
 * sign convention, which is exactly the kind of detail that goes wrong.
 *
 * @param {Record<string, any>} entry
 * @returns {number} signed paise
 */
export function accountEffect(entry) {
  if (!countsTowardBalance(entry)) return 0;

  // A reversal carries the SAME type as the entry it undoes, with a flag,
  // rather than being written as the opposite type. Reversing ₹100 of income
  // by recording ₹100 of expense would balance the account correctly but
  // inflate the expense total and corrupt every category report. The sign is
  // flipped here instead, where it affects the balance and nothing else.
  const sign = entry.reversalOf ? -1 : 1;

  if (entry.transferLeg === 'transferOut') return sign * -entry.amountPaise;
  if (entry.transferLeg === 'transferIn') return sign * entry.amountPaise;

  return sign * (entry.type === ENTRY_TYPE.INCOME ? entry.amountPaise : -entry.amountPaise);
}

/**
 * Current balance of every account.
 *
 * An account's opening balance only counts from its opening date onward, so
 * an account created mid-year does not retroactively change last quarter.
 *
 * @param {Array<Record<string, any>>} accounts
 * @param {Array<Record<string, any>>} entries every confirmed entry to include
 * @param {{ asOf?: string }} [options] ledger date to compute up to, inclusive
 * @returns {Array<{accountId: string, name: string, openingPaise: number,
 *   movementPaise: number, closingPaise: number, isActive: boolean}>}
 */
export function accountBalances(accounts, entries, options = {}) {
  const { asOf = null } = options;

  return accounts.map((account) => {
    const relevant = entries.filter((entry) => {
      if (entry.accountId !== account.accountId) return false;
      if (!countsTowardBalance(entry)) return false;
      if (entry.ledgerDate < account.openingBalanceDate) return false;
      if (asOf && entry.ledgerDate > asOf) return false;
      return true;
    });

    const movementPaise = sumBy(relevant, accountEffect);
    const openingPaise = account.openingBalancePaise ?? 0;

    return {
      accountId: account.accountId,
      name: account.name,
      type: account.type,
      isActive: account.isActive !== false,
      openingPaise,
      movementPaise,
      closingPaise: openingPaise + movementPaise,
    };
  });
}

/**
 * Total across active accounts. Inactive accounts are excluded from the
 * headline figure but their money has not vanished — the accounts screen
 * still shows each one, which is why this returns both numbers.
 *
 * @param {ReturnType<typeof accountBalances>} balances
 * @returns {{activePaise: number, allPaise: number}}
 */
export function overallBalance(balances) {
  return {
    activePaise: sumBy(balances.filter((b) => b.isActive), (b) => b.closingPaise),
    allPaise: sumBy(balances, (b) => b.closingPaise),
  };
}

/**
 * A day's opening, movement and closing figures.
 *
 * Opening balance for a date is the closing balance of everything before it —
 * computed, not stored, so it cannot disagree with the entries.
 *
 * @param {Array<Record<string, any>>} accounts
 * @param {Array<Record<string, any>>} allEntries entries up to and including the date
 * @param {string} ledgerDate
 * @returns {{openingPaise: number, incomePaise: number, expensePaise: number,
 *   netPaise: number, closingPaise: number}}
 */
export function dailyPosition(accounts, allEntries, ledgerDate) {
  const before = allEntries.filter((e) => e.ledgerDate < ledgerDate);
  const onDay = allEntries.filter((e) => e.ledgerDate === ledgerDate);

  const openingBalances = accountBalances(accounts, before, { asOf: ledgerDate });
  const openingPaise = overallBalance(openingBalances).activePaise;

  const { incomePaise, expensePaise, netPaise } = summariseEntries(onDay);

  // Transfers net to zero across accounts, so the day's closing balance moves
  // only by income minus expense. Asserting that here is what would catch an
  // unbalanced transfer immediately rather than at year end.
  const transferMovement = sumBy(
    onDay.filter((e) => isTransferLeg(e) && countsTowardBalance(e)),
    accountEffect,
  );

  return {
    openingPaise,
    incomePaise,
    expensePaise,
    netPaise,
    transferMovement,
    closingPaise: openingPaise + netPaise + transferMovement,
  };
}

/**
 * Running balance down a day's entries, for the ledger table and the PDF.
 * @param {Array<Record<string, any>>} entries in display order, oldest first
 * @param {number} openingPaise
 * @returns {Array<Record<string, any> & {runningPaise: number}>}
 */
export function withRunningBalance(entries, openingPaise) {
  let running = openingPaise;
  return entries.map((entry) => {
    running += accountEffect(entry);
    return { ...entry, runningPaise: running };
  });
}

/**
 * Totals per category, for the breakdown charts and category reports.
 * @param {Array<Record<string, any>>} entries
 * @param {'income'|'expense'} type
 * @returns {Array<{categoryId: string, name: string, totalPaise: number, count: number}>}
 */
export function categoryTotals(entries, type) {
  /** @type {Map<string, {categoryId: string, name: string, totalPaise: number, count: number}>} */
  const byCategory = new Map();

  for (const entry of entries) {
    if (!countsTowardBalance(entry) || isTransferLeg(entry)) continue;
    if (entry.type !== type) continue;

    const existing = byCategory.get(entry.categoryId) ?? {
      categoryId: entry.categoryId,
      name: entry.categoryNameSnapshot,
      totalPaise: 0,
      count: 0,
    };

    existing.totalPaise += entry.amountPaise;
    existing.count += 1;
    byCategory.set(entry.categoryId, existing);
  }

  return [...byCategory.values()].sort((a, b) => b.totalPaise - a.totalPaise);
}

/**
 * Monthly income and expense, for the dashboard chart.
 * @param {Array<Record<string, any>>} entries
 * @returns {Array<{month: string, incomePaise: number, expensePaise: number}>}
 */
export function monthlyTotals(entries) {
  /** @type {Map<string, {month: string, incomePaise: number, expensePaise: number}>} */
  const byMonth = new Map();

  for (const entry of entries) {
    if (!countsTowardBalance(entry) || isTransferLeg(entry)) continue;

    const month = entry.ledgerDate.slice(0, 7); // YYYY-MM
    const existing = byMonth.get(month) ?? { month, incomePaise: 0, expensePaise: 0 };

    if (entry.type === ENTRY_TYPE.INCOME) existing.incomePaise += entry.amountPaise;
    else existing.expensePaise += entry.amountPaise;

    byMonth.set(month, existing);
  }

  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}
