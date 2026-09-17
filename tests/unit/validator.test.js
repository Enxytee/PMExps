/**
 * The validator is the rule that the form, the repository and Firestore all
 * have to agree on. These tests pin the agreement down.
 */
import { describe, it, expect } from 'vitest';
import { validateEntry, validateAccount, validateCategory } from '../../js/validators/entry.js';
import { todayLedgerDate, addDays } from '../../js/utils/dates.js';

const accounts = [
  { accountId: 'acc1', name: 'Cash', type: 'cash', isActive: true },
  { accountId: 'acc2', name: 'Old Bank', type: 'bank', isActive: false },
];

const categories = [
  { categoryId: 'inc1', name: 'Sales', type: 'income', isActive: true },
  { categoryId: 'exp1', name: 'Bills', type: 'expense', isActive: true },
  { categoryId: 'exp2', name: 'Retired', type: 'expense', isActive: false },
];

const base = {
  type: 'expense',
  amountPaise: 125000,
  ledgerDate: todayLedgerDate(),
  description: 'Office electricity',
  accountId: 'acc1',
  categoryId: 'exp1',
  paymentMode: 'cash',
};

const context = { accounts, categories };

describe('validateEntry', () => {
  it('accepts a well-formed entry', () => {
    expect(validateEntry(base, context).valid).toBe(true);
  });

  it('rejects a zero amount, because a zero row is always a mistake', () => {
    const { valid, errors } = validateEntry({ ...base, amountPaise: 0 }, context);
    expect(valid).toBe(false);
    expect(errors.amountPaise).toMatch(/more than zero/i);
  });

  it('rejects a non-integer amount', () => {
    expect(validateEntry({ ...base, amountPaise: 12.5 }, context).valid).toBe(false);
  });

  it('rejects a category whose type does not match the entry type', () => {
    const { valid, errors } = validateEntry(
      { ...base, type: 'expense', categoryId: 'inc1' },
      context,
    );
    expect(valid).toBe(false);
    expect(errors.categoryId).toMatch(/income category/i);
  });

  it('rejects an inactive account', () => {
    const { errors } = validateEntry({ ...base, accountId: 'acc2' }, context);
    expect(errors.accountId).toMatch(/inactive/i);
  });

  it('rejects an inactive category', () => {
    const { errors } = validateEntry({ ...base, categoryId: 'exp2' }, context);
    expect(errors.categoryId).toMatch(/inactive/i);
  });

  it('rejects an account from another workspace', () => {
    const { errors } = validateEntry({ ...base, accountId: 'not-ours' }, context);
    expect(errors.accountId).toMatch(/not in this workspace/i);
  });

  it('rejects a date on or before the lock date', () => {
    const lockDate = todayLedgerDate();
    const { errors } = validateEntry(base, { ...context, lockDate });
    expect(errors.ledgerDate).toMatch(/closed/i);
  });

  it('allows the day after the lock date', () => {
    const lockDate = addDays(todayLedgerDate(), -1);
    expect(validateEntry(base, { ...context, lockDate }).valid).toBe(true);
  });

  it('rejects a date implausibly far ahead', () => {
    const { errors } = validateEntry(
      { ...base, ledgerDate: addDays(todayLedgerDate(), 400) },
      context,
    );
    expect(errors.ledgerDate).toMatch(/year ahead/i);
  });

  it('requires a description', () => {
    expect(validateEntry({ ...base, description: '   ' }, context).errors.description).toBeTruthy();
  });

  it('caps the description length', () => {
    const { errors } = validateEntry({ ...base, description: 'x'.repeat(201) }, context);
    expect(errors.description).toMatch(/under 200/i);
  });

  it('rejects an unknown payment mode', () => {
    expect(validateEntry({ ...base, paymentMode: 'crypto' }, context).errors.paymentMode).toBeTruthy();
  });

  it('reports every problem at once, not just the first', () => {
    const { errors } = validateEntry(
      { ...base, amountPaise: 0, description: '', accountId: '', categoryId: '' },
      context,
    );
    expect(Object.keys(errors).length).toBeGreaterThanOrEqual(4);
  });
});

describe('validateAccount', () => {
  const existing = [{ accountId: 'a1', name: 'Cash', type: 'cash' }];

  it('rejects a duplicate name regardless of case', () => {
    const { errors } = validateAccount(
      { name: 'cash', type: 'bank', openingBalancePaise: 0, openingBalanceDate: '2026-04-01' },
      { existing },
    );
    expect(errors.name).toMatch(/already exists/i);
  });

  it('allows the same name when editing that same account', () => {
    const result = validateAccount(
      { name: 'Cash', type: 'cash', openingBalancePaise: 0, openingBalanceDate: '2026-04-01' },
      { existing, editingId: 'a1' },
    );
    expect(result.valid).toBe(true);
  });

  it('allows a negative opening balance for a party who owes money', () => {
    const result = validateAccount(
      { name: 'Sharma & Co', type: 'party', openingBalancePaise: -50000, openingBalanceDate: '2026-04-01' },
      { existing },
    );
    expect(result.valid).toBe(true);
  });
});

describe('validateCategory', () => {
  const existing = [{ categoryId: 'c1', name: 'Travel', type: 'expense' }];

  it('allows the same name under a different type', () => {
    expect(validateCategory({ name: 'Travel', type: 'income' }, { existing }).valid).toBe(true);
  });

  it('rejects a duplicate name within the same type', () => {
    const { errors } = validateCategory({ name: 'travel', type: 'expense' }, { existing });
    expect(errors.name).toMatch(/already exists/i);
  });
});
