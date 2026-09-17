/**
 * PMExps — Report builders
 *
 * Every report is a shape applied to the same list of ledger entries, using
 * the same arithmetic as the dashboard and the daily ledger. There is no
 * separate reporting calculation anywhere, which is what guarantees the
 * specification's requirement that totals agree across the UI and the exports.
 *
 * Each builder returns the same structure — columns, rows, totals, meta — so
 * the view renders any report with one function and the CSV export writes any
 * report with one function. Adding a report means adding a builder, not a
 * screen.
 *
 * @module calculations/reports
 */

import {
  summariseEntries,
  accountBalances,
  overallBalance,
  categoryTotals,
  monthlyTotals,
  accountEffect,
  countsTowardBalance,
  isTransferLeg,
  withRunningBalance,
} from './balances.js';
import { formatPaise } from '../utils/money.js';
import { formatLedgerDate, ledgerDateRange } from '../utils/dates.js';
import { ENTRY_TYPE, ENTRY_STATUS } from '../config/constants.js';

/**
 * @typedef {object} Report
 * @property {string} id
 * @property {string} title
 * @property {string} subtitle
 * @property {Array<{key: string, label: string, align?: 'right', money?: boolean}>} columns
 * @property {Array<Record<string, any>>} rows
 * @property {Record<string, any>|null} totals
 * @property {string[]} [notes]
 */

/** Every report this application can produce. */
export const REPORT_TYPES = [
  { id: 'daily', label: 'Daily ledger' },
  { id: 'range', label: 'Date range' },
  { id: 'monthly', label: 'Monthly summary' },
  { id: 'account', label: 'Account statement' },
  { id: 'categoryIncome', label: 'Income by category' },
  { id: 'categoryExpense', label: 'Expenses by category' },
  { id: 'user', label: 'By person who entered' },
  { id: 'incomeVsExpense', label: 'Income vs expense' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'balances', label: 'Opening and closing balances' },
  { id: 'corrections', label: 'Corrections and audit' },
];

/**
 * Entries that belong in a financial report.
 *
 * Drafts are excluded everywhere. A report that counted drafts would be a
 * report of what someone intended, not of what happened — and the two are
 * exactly what this application exists to keep apart.
 *
 * @param {any[]} entries
 * @returns {any[]}
 */
function reportable(entries) {
  return entries.filter(countsTowardBalance);
}

/**
 * Apply the shared filters.
 * @param {any[]} entries
 * @param {Record<string, any>} filters
 * @returns {any[]}
 */
export function applyFilters(entries, filters = {}) {
  const { from, to, accountId, categoryId, enteredBy, type, search } = filters;
  const needle = String(search ?? '').trim().toLowerCase();

  return entries.filter((entry) => {
    if (from && entry.ledgerDate < from) return false;
    if (to && entry.ledgerDate > to) return false;
    if (accountId && entry.accountId !== accountId) return false;
    if (categoryId && entry.categoryId !== categoryId) return false;
    if (enteredBy && entry.enteredBy !== enteredBy) return false;
    if (type && entry.type !== type) return false;

    if (needle) {
      const haystack = [
        entry.description,
        entry.partyName,
        entry.referenceNumber,
        entry.remarks,
        entry.voucherNumber,
        entry.categoryNameSnapshot,
        entry.accountNameSnapshot,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }

    return true;
  });
}

/* -------------------------------------------------------------------------
   Builders
   ------------------------------------------------------------------------- */

const ENTRY_COLUMNS = [
  { key: 'ledgerDate', label: 'Date' },
  { key: 'voucherNumber', label: 'Voucher' },
  { key: 'description', label: 'Description' },
  { key: 'categoryNameSnapshot', label: 'Category' },
  { key: 'accountNameSnapshot', label: 'Account' },
  { key: 'paymentMode', label: 'Mode' },
  { key: 'incomePaise', label: 'Income', align: 'right', money: true },
  { key: 'expensePaise', label: 'Expense', align: 'right', money: true },
];

/**
 * Split an entry into income and expense columns, the way a ledger prints.
 * A reversal shows as a negative in its own column rather than jumping to the
 * other one, so the columns still add up to the category totals.
 * @param {Record<string, any>} entry
 */
function toLedgerRow(entry) {
  const signed = entry.reversalOf ? -entry.amountPaise : entry.amountPaise;
  const isTransfer = isTransferLeg(entry);

  return {
    ...entry,
    ledgerDate: entry.ledgerDate,
    voucherNumber: entry.voucherNumber ?? '',
    categoryNameSnapshot: isTransfer ? 'Transfer' : entry.categoryNameSnapshot,
    incomePaise: entry.type === ENTRY_TYPE.INCOME ? signed : 0,
    expensePaise: entry.type === ENTRY_TYPE.EXPENSE ? signed : 0,
  };
}

/**
 * Daily ledger or an arbitrary date range — the same report, different span.
 * @param {object} input
 * @returns {Report}
 */
export function buildEntriesReport({ entries, accounts, from, to, title }) {
  const rows = reportable(entries).map(toLedgerRow);
  const sums = summariseEntries(entries);

  // Opening balance for the span is everything that happened before it.
  const before = accounts && from ? accountBalances(accounts, entries.filter((e) => e.ledgerDate < from)) : null;
  const openingPaise = before ? overallBalance(before).activePaise : null;

  return {
    id: 'entries',
    title,
    subtitle: from === to ? formatLedgerDate(from) : `${formatLedgerDate(from)} to ${formatLedgerDate(to)}`,
    columns: ENTRY_COLUMNS,
    rows,
    totals: {
      label: `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`,
      incomePaise: sums.incomePaise,
      expensePaise: sums.expensePaise,
      netPaise: sums.netPaise,
      openingPaise,
      closingPaise: openingPaise === null ? null : openingPaise + sums.netPaise,
    },
  };
}

/**
 * Account statement with a running balance, the way a bank prints one.
 * @param {object} input
 * @returns {Report}
 */
export function buildAccountStatement({ entries, account, from, to }) {
  const forAccount = reportable(entries).filter((e) => e.accountId === account.accountId);

  const before = forAccount.filter((e) => e.ledgerDate < from && e.ledgerDate >= account.openingBalanceDate);
  const openingPaise =
    (account.openingBalancePaise ?? 0) + before.reduce((sum, e) => sum + accountEffect(e), 0);

  const inRange = forAccount
    .filter((e) => e.ledgerDate >= from && e.ledgerDate <= to)
    .sort((a, b) => a.ledgerDate.localeCompare(b.ledgerDate));

  const rows = withRunningBalance(inRange, openingPaise).map((entry) => ({
    ...toLedgerRow(entry),
    runningPaise: entry.runningPaise,
  }));

  const movement = inRange.reduce((sum, e) => sum + accountEffect(e), 0);

  return {
    id: 'account',
    title: `Account statement — ${account.name}`,
    subtitle: `${formatLedgerDate(from)} to ${formatLedgerDate(to)}`,
    columns: [
      { key: 'ledgerDate', label: 'Date' },
      { key: 'voucherNumber', label: 'Voucher' },
      { key: 'description', label: 'Description' },
      { key: 'categoryNameSnapshot', label: 'Category' },
      { key: 'incomePaise', label: 'In', align: 'right', money: true },
      { key: 'expensePaise', label: 'Out', align: 'right', money: true },
      { key: 'runningPaise', label: 'Balance', align: 'right', money: true },
    ],
    rows,
    totals: {
      label: `${rows.length} movements`,
      openingPaise,
      movementPaise: movement,
      closingPaise: openingPaise + movement,
    },
    notes: [
      `Opening balance ${formatPaise(openingPaise)} carried forward from before ${formatLedgerDate(from)}.`,
    ],
  };
}

/**
 * Category totals, largest first, with each line's share of the whole.
 * @param {object} input
 * @returns {Report}
 */
export function buildCategoryReport({ entries, type, from, to }) {
  const totals = categoryTotals(reportable(entries), type);
  const grandTotal = totals.reduce((sum, row) => sum + row.totalPaise, 0);

  const rows = totals.map((row) => ({
    ...row,
    // Share is computed from integers and rounded only for display, so the
    // percentages cannot drift from the amounts they describe.
    sharePercent: grandTotal === 0 ? 0 : Math.round((row.totalPaise / grandTotal) * 1000) / 10,
  }));

  return {
    id: `category-${type}`,
    title: type === ENTRY_TYPE.INCOME ? 'Income by category' : 'Expenses by category',
    subtitle: `${formatLedgerDate(from)} to ${formatLedgerDate(to)}`,
    columns: [
      { key: 'name', label: 'Category' },
      { key: 'count', label: 'Entries', align: 'right' },
      { key: 'sharePercent', label: 'Share %', align: 'right' },
      { key: 'totalPaise', label: 'Total', align: 'right', money: true },
    ],
    rows,
    totals: { label: `${rows.length} categories`, totalPaise: grandTotal },
  };
}

/**
 * Month by month, with the running net.
 * @param {object} input
 * @returns {Report}
 */
export function buildMonthlyReport({ entries, from, to }) {
  const months = monthlyTotals(reportable(entries));

  let running = 0;
  const rows = months.map((month) => {
    const net = month.incomePaise - month.expensePaise;
    running += net;
    return { ...month, netPaise: net, cumulativePaise: running };
  });

  return {
    id: 'monthly',
    title: 'Monthly summary',
    subtitle: `${formatLedgerDate(from)} to ${formatLedgerDate(to)}`,
    columns: [
      { key: 'month', label: 'Month' },
      { key: 'incomePaise', label: 'Income', align: 'right', money: true },
      { key: 'expensePaise', label: 'Expense', align: 'right', money: true },
      { key: 'netPaise', label: 'Net', align: 'right', money: true },
      { key: 'cumulativePaise', label: 'Cumulative', align: 'right', money: true },
    ],
    rows,
    totals: {
      label: `${rows.length} months`,
      incomePaise: rows.reduce((s, r) => s + r.incomePaise, 0),
      expensePaise: rows.reduce((s, r) => s + r.expensePaise, 0),
      netPaise: running,
    },
  };
}

/**
 * Who entered what. Useful for a business where several people record
 * transactions, and the first thing anyone asks after a discrepancy.
 * @param {object} input
 * @returns {Report}
 */
export function buildUserReport({ entries, from, to }) {
  /** @type {Map<string, any>} */
  const byUser = new Map();

  for (const entry of reportable(entries)) {
    const key = entry.enteredBy;
    const row = byUser.get(key) ?? {
      enteredBy: key,
      name: entry.enteredByName || key,
      count: 0,
      incomePaise: 0,
      expensePaise: 0,
    };

    row.count += 1;
    const signed = entry.reversalOf ? -entry.amountPaise : entry.amountPaise;
    if (isTransferLeg(entry)) {
      // Counted, but not as income or expense.
    } else if (entry.type === ENTRY_TYPE.INCOME) {
      row.incomePaise += signed;
    } else {
      row.expensePaise += signed;
    }

    byUser.set(key, row);
  }

  const rows = [...byUser.values()].sort((a, b) => b.count - a.count);

  return {
    id: 'user',
    title: 'Entries by person',
    subtitle: `${formatLedgerDate(from)} to ${formatLedgerDate(to)}`,
    columns: [
      { key: 'name', label: 'Entered by' },
      { key: 'count', label: 'Entries', align: 'right' },
      { key: 'incomePaise', label: 'Income', align: 'right', money: true },
      { key: 'expensePaise', label: 'Expense', align: 'right', money: true },
    ],
    rows,
    totals: {
      label: `${rows.length} people`,
      incomePaise: rows.reduce((s, r) => s + r.incomePaise, 0),
      expensePaise: rows.reduce((s, r) => s + r.expensePaise, 0),
    },
  };
}

/**
 * Income against expense, day by day.
 * @param {object} input
 * @returns {Report}
 */
export function buildIncomeVsExpense({ entries, from, to }) {
  const relevant = reportable(entries).filter((e) => !isTransferLeg(e));

  /** @type {Map<string, any>} */
  const byDate = new Map();
  for (const entry of relevant) {
    const row = byDate.get(entry.ledgerDate) ?? {
      ledgerDate: entry.ledgerDate,
      incomePaise: 0,
      expensePaise: 0,
    };
    const signed = entry.reversalOf ? -entry.amountPaise : entry.amountPaise;
    if (entry.type === ENTRY_TYPE.INCOME) row.incomePaise += signed;
    else row.expensePaise += signed;
    byDate.set(entry.ledgerDate, row);
  }

  const rows = [...byDate.values()]
    .sort((a, b) => a.ledgerDate.localeCompare(b.ledgerDate))
    .map((row) => ({ ...row, netPaise: row.incomePaise - row.expensePaise }));

  return {
    id: 'incomeVsExpense',
    title: 'Income versus expense',
    subtitle: `${formatLedgerDate(from)} to ${formatLedgerDate(to)}`,
    columns: [
      { key: 'ledgerDate', label: 'Date' },
      { key: 'incomePaise', label: 'Income', align: 'right', money: true },
      { key: 'expensePaise', label: 'Expense', align: 'right', money: true },
      { key: 'netPaise', label: 'Net', align: 'right', money: true },
    ],
    rows,
    totals: {
      label: `${rows.length} days with activity`,
      incomePaise: rows.reduce((s, r) => s + r.incomePaise, 0),
      expensePaise: rows.reduce((s, r) => s + r.expensePaise, 0),
      netPaise: rows.reduce((s, r) => s + r.netPaise, 0),
    },
  };
}

/**
 * Transfers, with reversals marked.
 * @param {object} input
 * @returns {Report}
 */
export function buildTransferReport({ transfers, from, to }) {
  const rows = transfers
    .filter((t) => t.ledgerDate >= from && t.ledgerDate <= to)
    .sort((a, b) => b.ledgerDate.localeCompare(a.ledgerDate))
    .map((transfer) => ({
      ...transfer,
      route: `${transfer.fromAccountNameSnapshot} \u2192 ${transfer.toAccountNameSnapshot}`,
      state: transfer.reversedByTransferId
        ? 'Reversed'
        : transfer.reversalOfTransferId
          ? 'Is a reversal'
          : 'Active',
    }));

  return {
    id: 'transfers',
    title: 'Transfers',
    subtitle: `${formatLedgerDate(from)} to ${formatLedgerDate(to)}`,
    columns: [
      { key: 'ledgerDate', label: 'Date' },
      { key: 'voucherNumber', label: 'Voucher' },
      { key: 'description', label: 'Description' },
      { key: 'route', label: 'From \u2192 To' },
      { key: 'state', label: 'State' },
      { key: 'amountPaise', label: 'Amount', align: 'right', money: true },
    ],
    rows,
    totals: {
      label: `${rows.length} transfers`,
      // Reversed pairs are excluded from the headline figure: counting both
      // would suggest twice as much money moved as actually did.
      amountPaise: rows
        .filter((r) => r.state === 'Active')
        .reduce((s, r) => s + r.amountPaise, 0),
    },
    notes: ['Transfers do not affect income, expense or the overall balance.'],
  };
}

/**
 * Every account's opening and closing position for the span.
 * @param {object} input
 * @returns {Report}
 */
export function buildBalanceReport({ entries, accounts, from, to }) {
  const openingBalances = accountBalances(accounts, entries.filter((e) => e.ledgerDate < from));
  const closingBalances = accountBalances(accounts, entries.filter((e) => e.ledgerDate <= to));

  const rows = accounts.map((account) => {
    const opening = openingBalances.find((b) => b.accountId === account.accountId);
    const closing = closingBalances.find((b) => b.accountId === account.accountId);
    return {
      name: account.name,
      type: account.type,
      isActive: account.isActive !== false,
      openingPaise: opening?.closingPaise ?? 0,
      movementPaise: (closing?.closingPaise ?? 0) - (opening?.closingPaise ?? 0),
      closingPaise: closing?.closingPaise ?? 0,
    };
  });

  return {
    id: 'balances',
    title: 'Opening and closing balances',
    subtitle: `${formatLedgerDate(from)} to ${formatLedgerDate(to)}`,
    columns: [
      { key: 'name', label: 'Account' },
      { key: 'openingPaise', label: 'Opening', align: 'right', money: true },
      { key: 'movementPaise', label: 'Movement', align: 'right', money: true },
      { key: 'closingPaise', label: 'Closing', align: 'right', money: true },
    ],
    rows,
    totals: {
      label: `${rows.length} accounts`,
      openingPaise: rows.filter((r) => r.isActive).reduce((s, r) => s + r.openingPaise, 0),
      movementPaise: rows.filter((r) => r.isActive).reduce((s, r) => s + r.movementPaise, 0),
      closingPaise: rows.filter((r) => r.isActive).reduce((s, r) => s + r.closingPaise, 0),
    },
    notes: ['Totals cover active accounts only. Inactive accounts are listed but not summed.'],
  };
}

/**
 * Corrections, with the reason attached to each.
 * @param {object} input
 * @returns {Report}
 */
export function buildCorrectionsReport({ entries, corrections, from, to }) {
  const reversals = reportable(entries).filter((e) => e.reversalOf);

  const rows = corrections
    .filter((c) => {
      const reversal = reversals.find((r) => r.correctionRequestId === c.requestId);
      const date = reversal?.ledgerDate;
      return !date || (date >= from && date <= to);
    })
    .map((correction) => ({
      targetVoucherNumber: correction.targetVoucherNumber || '—',
      status: correction.status,
      reason: correction.reason,
      requestedByName: correction.requestedByName ?? '',
      reviewedByName: correction.reviewedByName ?? '—',
    }));

  return {
    id: 'corrections',
    title: 'Corrections',
    subtitle: `${formatLedgerDate(from)} to ${formatLedgerDate(to)}`,
    columns: [
      { key: 'targetVoucherNumber', label: 'Original voucher' },
      { key: 'status', label: 'Outcome' },
      { key: 'requestedByName', label: 'Requested by' },
      { key: 'reviewedByName', label: 'Reviewed by' },
      { key: 'reason', label: 'Reason' },
    ],
    rows,
    totals: { label: `${rows.length} corrections` },
    notes: [
      'Every correction preserves the original entry. The reversal that cancelled it is a separate voucher in the ledger.',
    ],
  };
}
