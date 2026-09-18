/**
 * PMExps — Accounts and categories repository
 *
 * Neither collection has a delete path. Records are deactivated instead, so
 * a ledger row written in 2026 still resolves its account name in 2030 and a
 * report over a closed year does not develop holes.
 *
 * @module repositories/master-data
 */

import { db, firestore } from '../firebase/init.js';
import { currentUser } from '../services/auth.js';
import { validateAccount, validateCategory } from '../validators/entry.js';

const { doc, collection, setDoc, updateDoc, writeBatch, serverTimestamp } = firestore;

/** Error with a code and per-field messages. */
export class MasterDataError extends Error {
  /** @param {string} code @param {string} message @param {Record<string,string>} [errors] */
  constructor(code, message, errors = {}) {
    super(message);
    this.name = 'MasterDataError';
    this.code = code;
    this.errors = errors;
  }
}

/* -------------------------------------------------------------------------
   Accounts
   ------------------------------------------------------------------------- */

/**
 * @param {string} workspaceId
 * @param {Record<string, any>} account
 * @param {any[]} existing
 * @returns {Promise<string>}
 */
export async function createAccount(workspaceId, account, existing) {
  const user = currentUser();
  if (!user) throw new MasterDataError('unauthenticated', 'Sign in first.');

  const result = validateAccount(account, { existing });
  if (!result.valid) {
    throw new MasterDataError('validation-failed', 'Fix the highlighted fields.', result.errors);
  }

  const ref = doc(collection(db, 'workspaces', workspaceId, 'accounts'));

  await setDoc(ref, {
    accountId: ref.id,
    workspaceId,
    name: String(account.name).trim(),
    nameGu: nullIfBlank(account.nameGu),
    type: account.type,
    bankName: nullIfBlank(account.bankName),
    // Only a masked number is ever stored. A full account number in a
    // browser-readable document is a liability with no upside: nothing in
    // this app needs it, and a report only ever prints the last four digits.
    accountNumberMasked: maskAccountNumber(account.accountNumber),
    ifsc: nullIfBlank(account.ifsc),
    partyName: nullIfBlank(account.partyName),
    partyPhone: nullIfBlank(account.partyPhone),
    openingBalancePaise: account.openingBalancePaise,
    openingBalanceDate: account.openingBalanceDate,
    currency: 'INR',
    icon: account.icon ?? 'wallet',
    color: account.color ?? '#5b8cff',
    sortOrder: account.sortOrder ?? (existing.length + 1) * 10,
    isActive: true,
    isSystem: false,
    createdBy: user.uid,
    updatedBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return ref.id;
}

/**
 * @param {string} workspaceId
 * @param {string} accountId
 * @param {Record<string, any>} changes
 * @param {any[]} existing
 * @returns {Promise<void>}
 */
export async function updateAccount(workspaceId, accountId, changes, existing) {
  const user = currentUser();
  const current = existing.find((a) => a.accountId === accountId);
  if (!current) throw new MasterDataError('not-found', 'That account no longer exists.');

  const merged = { ...current, ...changes };
  const result = validateAccount(merged, { existing, editingId: accountId });
  if (!result.valid) {
    throw new MasterDataError('validation-failed', 'Fix the highlighted fields.', result.errors);
  }

  await updateDoc(doc(db, 'workspaces', workspaceId, 'accounts', accountId), {
    name: String(merged.name).trim(),
    nameGu: nullIfBlank(merged.nameGu),
    type: merged.type,
    bankName: nullIfBlank(merged.bankName),
    accountNumberMasked:
      'accountNumber' in changes
        ? maskAccountNumber(changes.accountNumber)
        : (current.accountNumberMasked ?? null),
    ifsc: nullIfBlank(merged.ifsc),
    partyName: nullIfBlank(merged.partyName),
    partyPhone: nullIfBlank(merged.partyPhone),
    openingBalancePaise: merged.openingBalancePaise,
    openingBalanceDate: merged.openingBalanceDate,
    icon: merged.icon ?? 'wallet',
    color: merged.color ?? '#5b8cff',
    sortOrder: merged.sortOrder ?? 0,
    isActive: merged.isActive !== false,
    updatedBy: user?.uid ?? null,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Deactivate or reactivate an account.
 * @param {string} workspaceId
 * @param {string} accountId
 * @param {boolean} isActive
 * @returns {Promise<void>}
 */
export async function setAccountActive(workspaceId, accountId, isActive) {
  await updateDoc(doc(db, 'workspaces', workspaceId, 'accounts', accountId), {
    isActive,
    updatedBy: currentUser()?.uid ?? null,
    updatedAt: serverTimestamp(),
  });
}

/* -------------------------------------------------------------------------
   Categories
   ------------------------------------------------------------------------- */

/**
 * @param {string} workspaceId
 * @param {Record<string, any>} category
 * @param {any[]} existing
 * @returns {Promise<string>}
 */
export async function createCategory(workspaceId, category, existing) {
  const user = currentUser();
  if (!user) throw new MasterDataError('unauthenticated', 'Sign in first.');

  const result = validateCategory(category, { existing });
  if (!result.valid) {
    throw new MasterDataError('validation-failed', 'Fix the highlighted fields.', result.errors);
  }

  const sameType = existing.filter((c) => c.type === category.type);
  const ref = doc(collection(db, 'workspaces', workspaceId, 'categories'));

  await setDoc(ref, {
    categoryId: ref.id,
    workspaceId,
    name: String(category.name).trim(),
    nameGu: nullIfBlank(category.nameGu),
    type: category.type,
    icon: category.icon ?? 'tag',
    color: category.color ?? '#5b8cff',
    sortOrder: category.sortOrder ?? (sameType.length + 1) * 10,
    isActive: true,
    isSystem: false,
    entryCount: 0,
    createdBy: user.uid,
    updatedBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return ref.id;
}

/**
 * @param {string} workspaceId
 * @param {string} categoryId
 * @param {Record<string, any>} changes
 * @param {any[]} existing
 * @returns {Promise<void>}
 */
export async function updateCategory(workspaceId, categoryId, changes, existing) {
  const current = existing.find((c) => c.categoryId === categoryId);
  if (!current) throw new MasterDataError('not-found', 'That category no longer exists.');

  const merged = { ...current, ...changes };

  // Changing income to expense would invert the sign of every historical
  // entry using this category, so it is refused once the category is in use.
  if (merged.type !== current.type && (current.entryCount ?? 0) > 0) {
    throw new MasterDataError(
      'category-in-use',
      'This category already has entries, so its type cannot be changed. Deactivate it and create a new one instead.',
      { type: 'Cannot change type once the category has been used.' },
    );
  }

  const result = validateCategory(merged, { existing, editingId: categoryId });
  if (!result.valid) {
    throw new MasterDataError('validation-failed', 'Fix the highlighted fields.', result.errors);
  }

  await updateDoc(doc(db, 'workspaces', workspaceId, 'categories', categoryId), {
    name: String(merged.name).trim(),
    nameGu: nullIfBlank(merged.nameGu),
    type: merged.type,
    icon: merged.icon ?? 'tag',
    color: merged.color ?? '#5b8cff',
    sortOrder: merged.sortOrder ?? 0,
    isActive: merged.isActive !== false,
    updatedBy: currentUser()?.uid ?? null,
    updatedAt: serverTimestamp(),
  });
}

/**
 * @param {string} workspaceId
 * @param {string} categoryId
 * @param {boolean} isActive
 * @returns {Promise<void>}
 */
export async function setCategoryActive(workspaceId, categoryId, isActive) {
  await updateDoc(doc(db, 'workspaces', workspaceId, 'categories', categoryId), {
    isActive,
    updatedBy: currentUser()?.uid ?? null,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Persist a new display order.
 * A batch rather than a transaction: reordering has no financial effect, so
 * atomicity is enough and a read-check would only cost latency.
 * @param {string} workspaceId
 * @param {'accounts'|'categories'} kind
 * @param {string[]} orderedIds
 * @returns {Promise<void>}
 */
export async function reorder(workspaceId, kind, orderedIds) {
  const batch = writeBatch(db);
  orderedIds.forEach((id, index) => {
    batch.update(doc(db, 'workspaces', workspaceId, kind, id), {
      sortOrder: (index + 1) * 10,
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();
}

/** @param {unknown} value @returns {string|null} */
function nullIfBlank(value) {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
}

/**
 * Keep only the last four digits: "123456783421" becomes "••••3421".
 * @param {unknown} value
 * @returns {string|null}
 */
function maskAccountNumber(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length < 4) return null;
  return `••••${digits.slice(-4)}`;
}
