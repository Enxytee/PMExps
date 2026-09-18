/**
 * PMExps — Ledger entry repository
 *
 * All Firestore access for `ledgerEntries` lives here. Views never touch the
 * SDK directly, so when confirmation moves into a transaction in Phase 4 only
 * this file changes.
 *
 * Phase 3 scope is **drafts only**. There is no function here that sets a
 * status to `confirmed`, allocates a voucher number, or touches a balance —
 * and Firestore rules would reject it if there were.
 *
 * @module repositories/entries
 */

import { db, firestore } from '../firebase/init.js';
import { currentUser } from '../services/auth.js';
import { validateEntry } from '../validators/entry.js';
import { financialYear } from '../utils/dates.js';
import { ENTRY_STATUS, DEFAULTS } from '../config/constants.js';

const {
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
} = firestore;

/** Error with a code the UI can localise. */
export class EntryError extends Error {
  /** @param {string} code @param {string} message @param {Record<string,string>} [errors] */
  constructor(code, message, errors = {}) {
    super(message);
    this.name = 'EntryError';
    this.code = code;
    this.errors = errors;
  }
}

/** @param {string} workspaceId */
function entriesRef(workspaceId) {
  return collection(db, 'workspaces', workspaceId, 'ledgerEntries');
}

/**
 * A client-generated idempotency key.
 *
 * Created once when the form opens and reused for every retry of that same
 * save. On a flaky mobile connection the first request may reach Firestore
 * and the response may be lost; without this key the user's second tap would
 * create a second entry for the same expense. Phase 4 uses it to make
 * confirmation retry-safe as well.
 *
 * @returns {string}
 */
export function newRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // Fallback for older browsers: time plus randomness is sufficient here
  // because the key only has to be unique within one workspace.
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Create a draft entry.
 *
 * Snapshots of the account and category names are written now so the row
 * reads correctly even if either is renamed later. The IDs are kept too, so
 * filtering and reports still follow the live records.
 *
 * @param {object} input
 * @param {string} input.workspaceId
 * @param {Record<string, any>} input.entry
 * @param {any[]} input.accounts
 * @param {any[]} input.categories
 * @param {string|null} [input.lockDate]
 * @returns {Promise<string>} the new entry ID
 */
export async function createDraft({
  workspaceId,
  entry,
  accounts,
  categories,
  lockDate = null,
}) {
  const user = currentUser();
  if (!user) throw new EntryError('unauthenticated', 'Sign in first.');

  const result = validateEntry(entry, { accounts, categories, lockDate });
  if (!result.valid) {
    throw new EntryError('validation-failed', 'Fix the highlighted fields.', result.errors);
  }

  const account = accounts.find((a) => a.accountId === entry.accountId);
  const category = categories.find((c) => c.categoryId === entry.categoryId);

  const ref = entry.entryId
    ? doc(db, 'workspaces', workspaceId, 'ledgerEntries', entry.entryId)
    : doc(entriesRef(workspaceId));

  await setDoc(ref, {
    entryId: ref.id,
    workspaceId,

    // A draft has no voucher number. It gets one only at confirmation, from
    // a counter, inside a transaction — never from the browser.
    voucherNumber: null,

    ledgerDate: entry.ledgerDate,
    financialYear: financialYear(entry.ledgerDate).token,
    type: entry.type,

    categoryId: entry.categoryId,
    categoryNameSnapshot: category?.name ?? '',
    // The Gujarati snapshot is frozen alongside the English one. Looking the
    // translation up at print time would silently change a historical voucher
    // if someone later renamed the category.
    categoryNameGuSnapshot: category?.nameGu ?? null,
    accountId: entry.accountId,
    accountNameSnapshot: account?.name ?? '',
    accountNameGuSnapshot: account?.nameGu ?? null,

    description: String(entry.description).trim(),
    partyName: emptyToNull(entry.partyName),
    paymentMode: entry.paymentMode,
    amountPaise: entry.amountPaise,
    referenceNumber: emptyToNull(entry.referenceNumber),
    remarks: emptyToNull(entry.remarks),
    attachments: [],

    status: ENTRY_STATUS.DRAFT,
    enteredBy: user.uid,
    enteredByName: user.displayName ?? user.email ?? '',

    confirmedBy: null,
    confirmedByName: null,
    confirmedAt: null,
    lockedBy: null,
    lockedAt: null,
    correctionOf: null,
    correctedBy: null,
    reversalOf: null,
    correctionRequestId: null,
    transferId: null,
    transferLeg: null,

    clientRequestId: entry.clientRequestId ?? newRequestId(),
    isSynced: true,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return ref.id;
}

/**
 * Update an existing draft.
 *
 * Only the fields a person can edit are sent. Everything protected is simply
 * absent from the payload, so even a bug here cannot rewrite a voucher number
 * or a confirmation timestamp.
 *
 * @param {object} input
 * @param {string} input.workspaceId
 * @param {string} input.entryId
 * @param {Record<string, any>} input.entry
 * @param {any[]} input.accounts
 * @param {any[]} input.categories
 * @param {string|null} [input.lockDate]
 * @returns {Promise<void>}
 */
export async function updateDraft({
  workspaceId,
  entryId,
  entry,
  accounts,
  categories,
  lockDate = null,
}) {
  const result = validateEntry(entry, { accounts, categories, lockDate });
  if (!result.valid) {
    throw new EntryError('validation-failed', 'Fix the highlighted fields.', result.errors);
  }

  const existing = await getEntry(workspaceId, entryId);
  if (!existing) throw new EntryError('not-found', 'That entry no longer exists.');
  if (existing.status !== ENTRY_STATUS.DRAFT) {
    throw new EntryError(
      'entry-immutable',
      'That entry is confirmed and cannot be edited. Request a correction instead.',
    );
  }

  const account = accounts.find((a) => a.accountId === entry.accountId);
  const category = categories.find((c) => c.categoryId === entry.categoryId);

  await updateDoc(doc(db, 'workspaces', workspaceId, 'ledgerEntries', entryId), {
    ledgerDate: entry.ledgerDate,
    financialYear: financialYear(entry.ledgerDate).token,
    type: entry.type,
    categoryId: entry.categoryId,
    categoryNameSnapshot: category?.name ?? '',
    categoryNameGuSnapshot: category?.nameGu ?? null,
    accountId: entry.accountId,
    accountNameSnapshot: account?.name ?? '',
    accountNameGuSnapshot: account?.nameGu ?? null,
    description: String(entry.description).trim(),
    partyName: emptyToNull(entry.partyName),
    paymentMode: entry.paymentMode,
    amountPaise: entry.amountPaise,
    referenceNumber: emptyToNull(entry.referenceNumber),
    remarks: emptyToNull(entry.remarks),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Retire a draft.
 *
 * Not a delete. The document moves to `voidDraft` so the record survives and
 * can be restored. Nothing financial is ever removed from this system.
 *
 * @param {string} workspaceId
 * @param {string} entryId
 * @returns {Promise<void>}
 */
export async function voidDraft(workspaceId, entryId) {
  const existing = await getEntry(workspaceId, entryId);
  if (!existing) throw new EntryError('not-found', 'That entry no longer exists.');
  if (existing.status !== ENTRY_STATUS.DRAFT) {
    throw new EntryError('entry-immutable', 'Only drafts can be removed.');
  }

  await updateDoc(doc(db, 'workspaces', workspaceId, 'ledgerEntries', entryId), {
    status: ENTRY_STATUS.VOID_DRAFT,
    updatedAt: serverTimestamp(),
  });
}

/** Restore a voided draft. @param {string} workspaceId @param {string} entryId */
export async function restoreDraft(workspaceId, entryId) {
  await updateDoc(doc(db, 'workspaces', workspaceId, 'ledgerEntries', entryId), {
    status: ENTRY_STATUS.DRAFT,
    updatedAt: serverTimestamp(),
  });
}

/**
 * @param {string} workspaceId
 * @param {string} entryId
 * @returns {Promise<Record<string, any>|null>}
 */
export async function getEntry(workspaceId, entryId) {
  const snapshot = await getDoc(
    doc(db, 'workspaces', workspaceId, 'ledgerEntries', entryId),
  );
  return snapshot.exists() ? snapshot.data() : null;
}

/**
 * Drafts awaiting action.
 * @param {string} workspaceId
 * @param {{ mineOnly?: boolean, uid?: string, pageSize?: number }} [options]
 * @returns {Promise<any[]>}
 */
export async function listDrafts(workspaceId, options = {}) {
  const { mineOnly = false, uid, pageSize = DEFAULTS.pageSize } = options;

  const constraints = [where('status', '==', ENTRY_STATUS.DRAFT)];
  if (mineOnly && uid) constraints.push(where('enteredBy', '==', uid));
  constraints.push(orderBy('updatedAt', 'desc'), limit(pageSize));

  const snapshot = await getDocs(query(entriesRef(workspaceId), ...constraints));
  return snapshot.docs.map((d) => d.data());
}

/**
 * Entries for one ledger date, newest first.
 *
 * Voided drafts are excluded here rather than in the UI, so no screen can
 * forget and show a retired row in a financial list.
 *
 * @param {string} workspaceId
 * @param {string} ledgerDate
 * @returns {Promise<any[]>}
 */
export async function listByDate(workspaceId, ledgerDate) {
  const snapshot = await getDocs(
    query(
      entriesRef(workspaceId),
      where('ledgerDate', '==', ledgerDate),
      orderBy('createdAt', 'desc'),
      limit(200),
    ),
  );

  return snapshot.docs
    .map((d) => d.data())
    .filter((entry) => entry.status !== ENTRY_STATUS.VOID_DRAFT);
}

/**
 * A page of recent entries, for the dashboard.
 * @param {string} workspaceId
 * @param {number} [count]
 * @returns {Promise<any[]>}
 */
export async function listRecent(workspaceId, count = 10) {
  const snapshot = await getDocs(
    query(
      entriesRef(workspaceId),
      orderBy('ledgerDate', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(count * 2),
    ),
  );

  return snapshot.docs
    .map((d) => d.data())
    .filter((entry) => entry.status !== ENTRY_STATUS.VOID_DRAFT)
    .slice(0, count);
}

/** @param {unknown} value @returns {string|null} */
function emptyToNull(value) {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
}

/**
 * Every entry up to and including a date, for balance calculations.
 *
 * This is the read that grows with the ledger. It is bounded for now and will
 * be replaced by date-range paging plus cached opening balances in Phase 6,
 * once there is enough history for the difference to matter.
 *
 * @param {string} workspaceId
 * @param {string} ledgerDate inclusive upper bound
 * @param {number} [max]
 * @returns {Promise<any[]>}
 */
export async function listUpTo(workspaceId, ledgerDate, max = 2000) {
  const snapshot = await getDocs(
    query(
      entriesRef(workspaceId),
      where('ledgerDate', '<=', ledgerDate),
      orderBy('ledgerDate', 'desc'),
      limit(max),
    ),
  );

  return snapshot.docs
    .map((d) => d.data())
    .filter((entry) => entry.status !== ENTRY_STATUS.VOID_DRAFT);
}

/**
 * Entries within a date range, for reports.
 * @param {string} workspaceId
 * @param {string} from inclusive
 * @param {string} to inclusive
 * @param {number} [max]
 * @returns {Promise<any[]>}
 */
export async function listRange(workspaceId, from, to, max = 3000) {
  const snapshot = await getDocs(
    query(
      entriesRef(workspaceId),
      where('ledgerDate', '>=', from),
      where('ledgerDate', '<=', to),
      orderBy('ledgerDate', 'desc'),
      limit(max),
    ),
  );

  return snapshot.docs
    .map((d) => d.data())
    .filter((entry) => entry.status !== ENTRY_STATUS.VOID_DRAFT);
}
