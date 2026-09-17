/**
 * Report builders and CSV export.
 *
 * The CSV tests include formula injection, which is the kind of thing that
 * looks paranoid until someone opens an export and a cell runs.
 */
import { describe, it, expect } from 'vitest';
import {
  applyFilters, buildEntriesReport, buildAccountStatement, buildCategoryReport,
  buildMonthlyReport, buildUserReport, buildIncomeVsExpense, buildBalanceReport,
} from '../../js/calculations/reports.js';
import { escapeCell, toCsv, csvAmount, sanitiseFileName } from '../../js/utils/csv.js';

const accounts = [
  { accountId: 'cash', name: 'Cash', type: 'cash', openingBalancePaise: 100000, openingBalanceDate: '2026-04-01', isActive: true },
  { accountId: 'bank', name: 'Bank', type: 'bank', openingBalancePaise: 0, openingBalanceDate: '2026-04-01', isActive: true },
];

const e = (over = {}) => ({
  entryId: 'x', status: 'confirmed', type: 'income', amountPaise: 10000,
  accountId: 'cash', accountNameSnapshot: 'Cash',
  categoryId: 'c1', categoryNameSnapshot: 'Sales',
  description: 'Sale', ledgerDate: '2026-05-10', voucherNumber: 'INC-2026-00001',
  enteredBy: 'u1', enteredByName: 'Asha', paymentMode: 'cash',
  transferId: null, transferLeg: null, reversalOf: null, ...over,
});

describe('applyFilters', () => {
  const entries = [
    e({ description: 'Tea for office', ledgerDate: '2026-05-01' }),
    e({ description: 'Freight', ledgerDate: '2026-05-20', accountId: 'bank', type: 'expense' }),
  ];

  it('filters by date range', () => {
    expect(applyFilters(entries, { from: '2026-05-10', to: '2026-05-31' })).toHaveLength(1);
  });

  it('filters by account and type', () => {
    expect(applyFilters(entries, { accountId: 'bank' })).toHaveLength(1);
    expect(applyFilters(entries, { type: 'expense' })).toHaveLength(1);
  });

  it('searches across description, voucher and party', () => {
    expect(applyFilters(entries, { search: 'tea' })).toHaveLength(1);
    expect(applyFilters(entries, { search: 'INC-2026' })).toHaveLength(2);
    expect(applyFilters(entries, { search: 'nothing here' })).toHaveLength(0);
  });
});

describe('buildEntriesReport', () => {
  it('splits income and expense into their own columns', () => {
    const report = buildEntriesReport({
      entries: [e({ amountPaise: 50000 }), e({ type: 'expense', amountPaise: 20000 })],
      accounts, from: '2026-05-01', to: '2026-05-31', title: 'Ledger',
    });
    expect(report.rows[0].incomePaise).toBe(50000);
    expect(report.rows[0].expensePaise).toBe(0);
    expect(report.totals.incomePaise).toBe(50000);
    expect(report.totals.expensePaise).toBe(20000);
    expect(report.totals.netPaise).toBe(30000);
  });

  it('excludes drafts from every total', () => {
    const report = buildEntriesReport({
      entries: [e({ amountPaise: 50000 }), e({ status: 'draft', amountPaise: 999999 })],
      accounts, from: '2026-05-01', to: '2026-05-31', title: 'Ledger',
    });
    expect(report.rows).toHaveLength(1);
    expect(report.totals.incomePaise).toBe(50000);
  });

  it('shows a reversal as a negative in its own column, not as the other type', () => {
    const report = buildEntriesReport({
      entries: [e({ amountPaise: 50000 }), e({ amountPaise: 50000, reversalOf: 'x' })],
      accounts, from: '2026-05-01', to: '2026-05-31', title: 'Ledger',
    });
    expect(report.rows[1].incomePaise).toBe(-50000);
    expect(report.rows[1].expensePaise).toBe(0);
    expect(report.totals.incomePaise).toBe(0);
    expect(report.totals.expensePaise).toBe(0);
  });
});

describe('buildAccountStatement', () => {
  it('carries an opening balance forward and runs a balance down the page', () => {
    const entries = [
      e({ ledgerDate: '2026-04-15', amountPaise: 25000 }),
      e({ ledgerDate: '2026-05-05', amountPaise: 10000 }),
      e({ ledgerDate: '2026-05-06', type: 'expense', amountPaise: 4000 }),
    ];
    const report = buildAccountStatement({
      entries, account: accounts[0], from: '2026-05-01', to: '2026-05-31',
    });
    expect(report.totals.openingPaise).toBe(125000);
    expect(report.rows.map((r) => r.runningPaise)).toEqual([135000, 131000]);
    expect(report.totals.closingPaise).toBe(131000);
  });
});

describe('buildCategoryReport', () => {
  it('ranks categories and shares add to 100', () => {
    const report = buildCategoryReport({
      entries: [
        e({ type: 'expense', categoryId: 'a', categoryNameSnapshot: 'Rent', amountPaise: 75000 }),
        e({ type: 'expense', categoryId: 'b', categoryNameSnapshot: 'Tea', amountPaise: 25000 }),
      ],
      type: 'expense', from: '2026-05-01', to: '2026-05-31',
    });
    expect(report.rows[0].name).toBe('Rent');
    expect(report.rows[0].sharePercent).toBe(75);
    expect(report.rows.reduce((s, r) => s + r.sharePercent, 0)).toBe(100);
    expect(report.totals.totalPaise).toBe(100000);
  });
});

describe('buildMonthlyReport', () => {
  it('accumulates a running net across months', () => {
    const report = buildMonthlyReport({
      entries: [
        e({ ledgerDate: '2026-04-10', amountPaise: 30000 }),
        e({ ledgerDate: '2026-05-10', type: 'expense', amountPaise: 10000 }),
      ],
      from: '2026-04-01', to: '2026-05-31',
    });
    expect(report.rows.map((r) => r.cumulativePaise)).toEqual([30000, 20000]);
  });
});

describe('buildUserReport', () => {
  it('groups by the person who entered', () => {
    const report = buildUserReport({
      entries: [
        e({ enteredBy: 'u1', enteredByName: 'Asha', amountPaise: 10000 }),
        e({ enteredBy: 'u2', enteredByName: 'Ravi', type: 'expense', amountPaise: 5000 }),
        e({ enteredBy: 'u1', enteredByName: 'Asha', amountPaise: 2000 }),
      ],
      from: '2026-05-01', to: '2026-05-31',
    });
    expect(report.rows[0].name).toBe('Asha');
    expect(report.rows[0].count).toBe(2);
    expect(report.rows[0].incomePaise).toBe(12000);
  });
});

describe('buildBalanceReport', () => {
  it('reports opening, movement and closing per account', () => {
    const report = buildBalanceReport({
      entries: [
        e({ ledgerDate: '2026-04-10', amountPaise: 20000 }),
        e({ ledgerDate: '2026-05-10', amountPaise: 30000 }),
      ],
      accounts, from: '2026-05-01', to: '2026-05-31',
    });
    const cash = report.rows.find((r) => r.name === 'Cash');
    expect(cash.openingPaise).toBe(120000);
    expect(cash.movementPaise).toBe(30000);
    expect(cash.closingPaise).toBe(150000);
  });
});

describe('CSV export', () => {
  it('quotes fields containing commas, quotes or newlines', () => {
    expect(escapeCell('Sharma, Bros')).toBe('"Sharma, Bros"');
    expect(escapeCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(escapeCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it.each(['=1+1', '+SUM(A1)', '-2+3', '@SUM(A1)'])(
    'neutralises the formula %s so a spreadsheet cannot execute it',
    (payload) => {
      expect(escapeCell(payload).replace(/"/g, '').startsWith("'")).toBe(true);
    },
  );

  it('neutralises a real attack payload', () => {
    const attack = '=HYPERLINK("http://evil.example/steal","Click me")';
    const cell = escapeCell(attack);
    expect(cell.startsWith('"\'=') || cell.startsWith("'=")).toBe(true);
  });

  it('leaves ordinary text alone', () => {
    expect(escapeCell('Office rent')).toBe('Office rent');
    expect(escapeCell('ચા બિલ')).toBe('ચા બિલ');
  });

  it('writes money as a plain decimal a spreadsheet can sum', () => {
    expect(csvAmount(12500050)).toBe('125000.50');
    expect(csvAmount(5)).toBe('0.05');
    // Not "₹1,25,000.50" — grouping would make it a text cell.
    expect(csvAmount(12500050)).not.toMatch(/[₹,]/);
  });

  it('uses CRLF line endings as RFC 4180 requires', () => {
    const csv = toCsv(['A', 'B'], [[1, 2]]);
    expect(csv).toBe('A,B\r\n1,2');
  });

  it('makes file names safe on every platform', () => {
    expect(sanitiseFileName('Ledger 01/05/2026: final')).toBe('Ledger-01-05-2026-final');
    expect(sanitiseFileName('')).toBe('pmexps-export');
  });
});
