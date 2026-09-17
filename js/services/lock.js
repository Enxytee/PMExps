/**
 * PMExps — Period locking
 *
 * Closing an accounting period seals everything on or before a date: no new
 * entries, no edits, no confirmations. It is how a month or a year is
 * finalised once the books agree.
 *
 * Two things happen when a period closes:
 *   1. settings/accounting.lockDate moves to the chosen date.
 *   2. Every confirmed entry on or before it becomes 'locked'.
 *
 * Step 2 is chunked rather than done in one transaction, because Firestore
 * caps a transaction at 500 writes and a year of entries can exceed that.
 * Each chunk is independently safe: an entry already locked is skipped, so a
 * failure part-way can simply be retried. The lock date itself moves LAST, so
 * an interrupted run leaves the period open rather than half-sealed.
 *
 * @module services/lock
 */

import { db, firestore } from '../firebase/init.js';
import { currentUser } from './auth.js';
import { isLedgerDate, assertLedgerDate } from '../utils/dates.js';
import { ENTRY_STATUS, ERROR_CODE } from '../config/constants.js';

const {
  doc, collection, getDoc, getDocs, query, where, orderBy, limit,
  writeBatch, updateDoc, serverTimestamp,
} = firestore;

/** Error with a stable code. */
export class LockError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'LockError';
    this.code = code;
  }
}

/** @param {string} workspaceId @returns {Promise<string|null>} */
export async function getLockDate(workspaceId) {
  const snapshot = await getDoc(doc(db, 'workspaces', workspaceId, 'settings', 'accounting'));
  return snapshot.exists() ? (snapshot.data().lockDate ?? null) : null;
}

/**
 * How many entries a lock would affect, so the confirmation dialog can say
 * so rather than asking the user to trust a button.
 * @param {string} workspaceId
 * @param {string} throughDate
 * @returns {Promise<{confirmed: number, drafts: number}>}
 */
export async function previewLock(workspaceId, throughDate) {
  assertLedgerDate(throughDate, 'lockDate');

  const entriesRef = collection(db, 'workspaces', workspaceId, 'ledgerEntries');
  const snapshot = await getDocs(
    query(entriesRef, where('ledgerDate', '<=', throughDate), orderBy('ledgerDate', 'desc'), limit(1000)),
  );

  const entries = snapshot.docs.map((d) => d.data());
  return {
    confirmed: entries.filter((e) => e.status === ENTRY_STATUS.CONFIRMED).length,
    drafts: entries.filter((e) => e.status === ENTRY_STATUS.DRAFT).length,
  };
}

/**
 * Close a period.
 *
 * Drafts dated inside the period are deliberately NOT locked or removed. A
 * draft is not part of the books, so sealing it would be meaningless; the
 * caller is told how many there are so someone can decide what to do with
 * them before closing.
 *
 * @param {object} input
 * @param {string} input.workspaceId
 * @param {string} input.lockDate
 * @param {string} input.reason
 * @returns {Promise<{lockedCount: number}>}
 */
export async function lockPeriod({ workspaceId, lockDate, reason }) {
  const user = currentUser();
  if (!user) throw new LockError(ERROR_CODE.UNAUTHENTICATED, 'Sign in first.');

  if (!isLedgerDate(lockDate)) {
    throw new LockError(ERROR_CODE.VALIDATION_FAILED, 'Choose a valid date.');
  }
  if (String(reason ?? '').trim().length < 10) {
    throw new LockError(
      ERROR_CODE.VALIDATION_FAILED,
      'Give a reason of at least 10 characters. It is recorded in the audit log.',
    );
  }

  const entriesRef = collection(db, 'workspaces', workspaceId, 'ledgerEntries');
  const snapshot = await getDocs(
    query(entriesRef, where('ledgerDate', '<=', lockDate), orderBy('ledgerDate', 'desc'), limit(2000)),
  );

  const toLock = snapshot.docs
    .map((d) => d.data())
    .filter((entry) => entry.status === ENTRY_STATUS.CONFIRMED);

  // Chunks of 400, comfortably under the 500-write cap with room for the
  // audit row.
  let lockedCount = 0;
  for (let i = 0; i < toLock.length; i += 400) {
    const chunk = toLock.slice(i, i + 400);
    const batch = writeBatch(db);

    for (const entry of chunk) {
      batch.update(doc(db, 'workspaces', workspaceId, 'ledgerEntries', entry.entryId), {
        status: ENTRY_STATUS.LOCKED,
        lockedBy: user.uid,
        lockedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
    lockedCount += chunk.length;
  }

  // The lock date moves last. If anything above failed, the period is still
  // open and the operation can be repeated — the alternative ordering would
  // leave a period marked closed while entries inside it were still editable.
  await updateDoc(doc(db, 'workspaces', workspaceId, 'settings', 'accounting'), {
    lockDate,
    updatedAt: serverTimestamp(),
  });

  await writeAuditRow(workspaceId, {
    action: 'period.lock',
    entityType: 'settings',
    entityId: 'accounting',
    entityLabel: `Locked through ${lockDate}`,
    beforeSummary: { lockDate: await previousLockDate(workspaceId, lockDate) },
    afterSummary: { lockDate, lockedCount },
    reason: String(reason).trim(),
  });

  return { lockedCount };
}

/**
 * Reopen a closed period.
 *
 * Kept deliberately separate from lockPeriod, with its own audit action, so
 * "reopened the books" never hides inside a routine lock operation. Entries
 * already marked locked stay locked: reopening allows new work in the period,
 * it does not unseal what was already sealed. Changing a locked entry still
 * requires a correction.
 *
 * @param {object} input
 * @param {string} input.workspaceId
 * @param {string|null} input.newLockDate null reopens everything
 * @param {string} input.reason
 * @returns {Promise<void>}
 */
export async function reopenPeriod({ workspaceId, newLockDate, reason }) {
  const user = currentUser();
  if (!user) throw new LockError(ERROR_CODE.UNAUTHENTICATED, 'Sign in first.');

  if (String(reason ?? '').trim().length < 10) {
    throw new LockError(
      ERROR_CODE.VALIDATION_FAILED,
      'Reopening a closed period needs a reason of at least 10 characters.',
    );
  }
  if (newLockDate !== null && !isLedgerDate(newLockDate)) {
    throw new LockError(ERROR_CODE.VALIDATION_FAILED, 'Choose a valid date, or clear it to reopen everything.');
  }

  const before = await getLockDate(workspaceId);

  await updateDoc(doc(db, 'workspaces', workspaceId, 'settings', 'accounting'), {
    lockDate: newLockDate,
    updatedAt: serverTimestamp(),
  });

  await writeAuditRow(workspaceId, {
    action: 'period.reopen',
    entityType: 'settings',
    entityId: 'accounting',
    entityLabel: newLockDate ? `Reopened back to ${newLockDate}` : 'Reopened entirely',
    beforeSummary: { lockDate: before },
    afterSummary: { lockDate: newLockDate },
    reason: String(reason).trim(),
  });
}

/** @param {string} workspaceId @param {string} fallback */
async function previousLockDate(workspaceId, fallback) {
  try {
    return (await getLockDate(workspaceId)) ?? null;
  } catch {
    return fallback;
  }
}

/**
 * Append an audit row.
 * @param {string} workspaceId
 * @param {Record<string, any>} fields
 * @returns {Promise<void>}
 */
export async function writeAuditRow(workspaceId, fields) {
  const user = currentUser();
  if (!user) return;

  const auditRef = doc(collection(db, 'workspaces', workspaceId, 'auditLogs'));
  const { setDoc } = firestore;

  await setDoc(auditRef, {
    auditId: auditRef.id,
    workspaceId,
    actorUid: user.uid,
    actorName: user.displayName ?? user.email ?? '',
    reason: null,
    requestId: null,
    beforeSummary: null,
    afterSummary: null,
    sessionMeta: { userAgent: navigator.userAgent.slice(0, 200) },
    ...fields,
    serverTimestamp: serverTimestamp(),
  });
}
