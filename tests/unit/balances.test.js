/**
 * Balance arithmetic. These tests exist because the whole application is a
 * claim about numbers: if the dashboard and the ledger ever disagree, the
 * product is worthless regardless of how it looks.
 */
import { describe, it, expect } from 'vitest';
import {
  summariseEntries, summariseDrafts, accountEffect, accountBalances,
  overallBalance, dailyPosition, withRunningBalance, categoryTotals, monthlyTotals,
} from '../../js/calculations/balances.js';
import { formatVoucher, counterFor, parseVoucher, isVoucherNumber } from '../../js/utils/voucher.js';

const accounts = [
  { accountId: 'cash', name: 'Cash', openingBalancePaise: 100000, openingBalanceDate: '2026-04-01', isActive: true },
  { accountId: 'bank', name: 'Bank', openingBalancePaise: 500000, openingBalanceDate: '2026-04-01', isActive: true },
  { accountId: 'old', name: 'Closed', openingBalancePaise: 20000, openingBalanceDate: '2026-04-01', isActive: false },
];

const entry = (over = {}) => ({
  status: 'confirmed', type: 'income', amountPaise: 10000,
  accountId: 'cash', categoryId: 'c1', categoryNameSnapshot: 'Sales',
  ledgerDate: '2026-05-10', transferId: null, transferLeg: null, ...over,
});

describe('summariseEntries', () => {
  it('adds income and expense separately', () => {
    const r = summariseEntries([
      entry({ amountPaise: 125000 }),
      entry({ type: 'expense', amountPaise: 25000 }),
    ]);
    expect(r.incomePaise).toBe(125000);
    expect(r.expensePaise).toBe(25000);
    expect(r.netPaise).toBe(100000);
  });

  it('ignores drafts', () => {
    const r = summariseEntries([entry({ status: 'draft', amountPaise: 999999 })]);
    expect(r.incomePaise).toBe(0);
  });

  it('excludes transfer legs, which are not income or expense', () => {
    const r = summariseEntries([
      entry({ amountPaise: 50000 }),
      entry({ transferId: 't1', transferLeg: 'transferIn', amountPaise: 30000 }),
      entry({ transferId: 't1', transferLeg: 'transferOut', type: 'expense', amountPaise: 30000, accountId: 'bank' }),
    ]);
    expect(r.incomePaise).toBe(50000);
    expect(r.expensePaise).toBe(0);
  });
});

describe('accountEffect', () => {
  it('income adds, expense subtracts', () => {
    expect(accountEffect(entry({ amountPaise: 5000 }))).toBe(5000);
    expect(accountEffect(entry({ type: 'expense', amountPaise: 5000 }))).toBe(-5000);
  });

  it('follows the transfer leg direction, not the entry type', () => {
    expect(accountEffect(entry({ transferId: 't', transferLeg: 'transferOut', amountPaise: 5000 }))).toBe(-5000);
    expect(accountEffect(entry({ transferId: 't', transferLeg: 'transferIn', type: 'expense', amountPaise: 5000 }))).toBe(5000);
  });

  it('a draft moves nothing', () => {
    expect(accountEffect(entry({ status: 'draft', amountPaise: 5000 }))).toBe(0);
  });
});

describe('accountBalances', () => {
  it('applies opening balance plus movement', () => {
    const b = accountBalances(accounts, [entry({ amountPaise: 25000 })]);
    const cash = b.find((x) => x.accountId === 'cash');
    expect(cash.openingPaise).toBe(100000);
    expect(cash.movementPaise).toBe(25000);
    expect(cash.closingPaise).toBe(125000);
  });

  it('ignores entries dated before the account opened', () => {
    const b = accountBalances(accounts, [entry({ ledgerDate: '2026-03-31', amountPaise: 99999 })]);
    expect(b.find((x) => x.accountId === 'cash').movementPaise).toBe(0);
  });

  it('a balanced transfer leaves the overall total unchanged', () => {
    const entries = [
      entry({ transferId: 't1', transferLeg: 'transferOut', accountId: 'cash', amountPaise: 30000 }),
      entry({ transferId: 't1', transferLeg: 'transferIn', accountId: 'bank', amountPaise: 30000 }),
    ];
    const before = overallBalance(accountBalances(accounts, []));
    const after = overallBalance(accountBalances(accounts, entries));
    expect(after.activePaise).toBe(before.activePaise);
  });

  it('separates active from all accounts', () => {
    const o = overallBalance(accountBalances(accounts, []));
    expect(o.activePaise).toBe(600000);
    expect(o.allPaise).toBe(620000);
  });
});

describe('dailyPosition', () => {
  it('opening balance is everything before the date', () => {
    const history = [
      entry({ ledgerDate: '2026-05-09', amountPaise: 40000 }),
      entry({ ledgerDate: '2026-05-10', amountPaise: 10000 }),
    ];
    const p = dailyPosition(accounts, history, '2026-05-10');
    expect(p.openingPaise).toBe(640000);
    expect(p.incomePaise).toBe(10000);
    expect(p.closingPaise).toBe(650000);
  });

  it('closing equals opening plus net when there are no transfers', () => {
    const history = [entry({ amountPaise: 10000 }), entry({ type: 'expense', amountPaise: 3000 })];
    const p = dailyPosition(accounts, history, '2026-05-10');
    expect(p.closingPaise).toBe(p.openingPaise + p.netPaise);
  });
});

describe('withRunningBalance', () => {
  it('accumulates down the rows and ends at the closing balance', () => {
    const rows = withRunningBalance(
      [entry({ amountPaise: 10000 }), entry({ type: 'expense', amountPaise: 4000 }), entry({ amountPaise: 1000 })],
      100000,
    );
    expect(rows.map((r) => r.runningPaise)).toEqual([110000, 106000, 107000]);
  });
});

describe('categoryTotals and monthlyTotals', () => {
  it('groups by category, largest first', () => {
    const totals = categoryTotals([
      entry({ type: 'expense', categoryId: 'a', categoryNameSnapshot: 'Rent', amountPaise: 50000 }),
      entry({ type: 'expense', categoryId: 'b', categoryNameSnapshot: 'Tea', amountPaise: 2000 }),
      entry({ type: 'expense', categoryId: 'a', categoryNameSnapshot: 'Rent', amountPaise: 10000 }),
    ], 'expense');
    expect(totals[0]).toMatchObject({ name: 'Rent', totalPaise: 60000, count: 2 });
    expect(totals[1].name).toBe('Tea');
  });

  it('groups by month in order', () => {
    const months = monthlyTotals([
      entry({ ledgerDate: '2026-06-01', amountPaise: 5000 }),
      entry({ ledgerDate: '2026-05-01', amountPaise: 3000 }),
    ]);
    expect(months.map((m) => m.month)).toEqual(['2026-05', '2026-06']);
  });
});

describe('voucher numbers', () => {
  it('formats with five-digit padding', () => {
    expect(formatVoucher('INC', '2026', 1)).toBe('INC-2026-00001');
    expect(formatVoucher('EXP', '2026', 99999)).toBe('EXP-2026-99999');
  });

  it('refuses a sequence beyond the width rather than mis-padding', () => {
    expect(() => formatVoucher('INC', '2026', 100000)).toThrow();
  });

  it('refuses zero and negatives', () => {
    expect(() => formatVoucher('INC', '2026', 0)).toThrow();
    expect(() => formatVoucher('INC', '2026', -1)).toThrow();
  });

  it('picks the counter by financial year, not calendar year', () => {
    // 31 March 2026 belongs to FY 2025-26; 1 April 2026 starts FY 2026-27.
    expect(counterFor('income', '2026-03-31').counterId).toBe('INC-2025');
    expect(counterFor('income', '2026-04-01').counterId).toBe('INC-2026');
  });

  it('round-trips', () => {
    expect(parseVoucher('EXP-2026-00042')).toEqual({ prefix: 'EXP', yearToken: '2026', sequence: 42 });
  });

  it('recognises malformed numbers', () => {
    expect(isVoucherNumber('INC-2026-00001')).toBe(true);
    expect(isVoucherNumber('INC-2026-1')).toBe(false);
    expect(isVoucherNumber('draft')).toBe(false);
  });
});
