/**
 * PMExps — Confirmation
 *
 * Turning a draft into a confirmed entry is the moment money becomes real in
 * this system, so it is the one operation written with the most care.
 *
 * Four documents change together, in a single Firestore transaction:
 *
 *   1. the voucher counter          lastNumber: n → n+1
 *   2. the entry                    draft → confirmed, gains voucher number n+1
 *   3. an audit log row             append-only record of who and when
 *   4. an idempotency marker        so a retry returns rather than repeats
 *
 * Firestore commits all four or none. There is no state where a number was
 * consumed but the entry did not save, and none where two entries share a
 * number — the second would need the counter to stay still, which the rules
 * forbid.
 *
 * Because this project runs without Cloud Functions, the transaction is
 * issued by the browser. That is safe only because firestore.rules re-derives
 * every constraint server-side: the counter may only increase by one, the
 * voucher number written on the entry must equal the counter's value after
 * the commit, the financial fields must be untouched, and confirmedAt must be
 * the server's clock. A tampered client can attempt this; Firestore rejects it.
 *
 * @module services/confirm
 */

import { db, firestore } from '../firebase/init.js';
import { currentUser } from './auth.js';
import { formatVoucher, counterFor } from '../utils/voucher.js';
import { isDateLocked } from '../utils/dates.js';
import { ENTRY_STATUS, ERROR_CODE } from '../config/constants.js';
import { assertPaise } from '../utils/money.js';
import { requireOnline } from './connectivity.js';

const { doc, runTransaction, serverTimestamp, getDoc } = firestore;

/** Error carrying a stable code. */
export class ConfirmError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'ConfirmError';
    this.code = code;
  }
}

/**
 * The workspace's current accounting lock date, or null.
 * @param {string} workspaceId
 * @returns {Promise<string|null>}
 */
export async function getLockDate(workspaceId) {
  const snapshot = await getDoc(doc(db, 'workspaces', workspaceId, 'settings', 'accounting'));
  return snapshot.exists() ? (snapshot.data().lockDate ?? null) : null;
}

/**
 * Confirm a draft entry.
 *
 * @param {object} input
 * @param {string} input.workspaceId
 * @param {string} input.entryId
 * @returns {Promise<{voucherNumber: string, alreadyConfirmed: boolean}>}
 */
export async function confirmEntry({ workspaceId, entryId }) {
  const user = currentUser();
  if (!user) throw new ConfirmError(ERROR_CODE.UNAUTHENTICATED, 'Sign in first.');

  // Refused rather than queued. Offline, the voucher counter in the local
  // cache may be stale, and two devices would allocate the same number to
  // two different entries — a duplicate that is very hard to unpick later.
  requireOnline('Confirming an entry');

  const entryRef = doc(db, 'workspaces', workspaceId, 'ledgerEntries', entryId);

  return runTransaction(db, async (tx) => {
    const entrySnapshot = await tx.get(entryRef);
    if (!entrySnapshot.exists()) {
      throw new ConfirmError(ERROR_CODE.NOT_FOUND, 'That entry no longer exists.');
    }

    const entry = entrySnapshot.data();

    // Idempotency by observation rather than by a lookup table: if the entry
    // is already confirmed, the work is done. A duplicate tap, a retried
    // request after a dropped response, or two tabs racing all land here and
    // get the same answer instead of a second voucher number.
    if (entry.status === ENTRY_STATUS.CONFIRMED || entry.status === ENTRY_STATUS.LOCKED) {
      return { voucherNumber: entry.voucherNumber, alreadyConfirmed: true };
    }

    if (entry.status !== ENTRY_STATUS.DRAFT) {
      throw new ConfirmError(
        ERROR_CODE.INVALID_TRANSITION,
        'Only a draft can be confirmed.',
      );
    }

    // Re-validate server-side facts inside the transaction, not before it.
    // Checking the lock date beforehand would leave a window in which a
    // Super Admin closes the period between the check and the commit.
    const settingsRef = doc(db, 'workspaces', workspaceId, 'settings', 'accounting');
    const settingsSnapshot = await tx.get(settingsRef);
    const lockDate = settingsSnapshot.exists()
      ? (settingsSnapshot.data().lockDate ?? null)
      : null;

    if (isDateLocked(entry.ledgerDate, lockDate)) {
      throw new ConfirmError(
        ERROR_CODE.DATE_LOCKED,
        `${entry.ledgerDate} is in a closed period. Ask a Super Admin to reopen it or use a later date.`,
      );
    }

    assertPaise(entry.amountPaise, { field: 'Amount' });

    // ---- Allocate the number -------------------------------------------
    const { counterId, prefix, yearToken } = counterFor(entry.type, entry.ledgerDate);
    const counterRef = doc(db, 'workspaces', workspaceId, 'voucherCounters', counterId);
    const counterSnapshot = await tx.get(counterRef);

    const lastNumber = counterSnapshot.exists() ? (counterSnapshot.data().lastNumber ?? 0) : 0;
    const nextNumber = lastNumber + 1;
    const voucherNumber = formatVoucher(prefix, yearToken, nextNumber);

    tx.set(
      counterRef,
      {
        counterId,
        workspaceId,
        prefix,
        financialYear: yearToken,
        lastNumber: nextNumber,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    // ---- Confirm the entry ---------------------------------------------
    // Only lifecycle fields are written. Every financial field is absent from
    // this update, which is both a safety property and what the rules check:
    // an amount or a date changing during confirmation is rejected.
    tx.update(entryRef, {
      status: ENTRY_STATUS.CONFIRMED,
      voucherNumber,
      confirmedBy: user.uid,
      confirmedByName: user.displayName ?? user.email ?? '',
      confirmedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // ---- Audit ----------------------------------------------------------
    const auditRef = doc(
      db,
      'workspaces',
      workspaceId,
      'auditLogs',
      `${entryId}-confirm-${nextNumber}`,
    );

    tx.set(auditRef, {
      auditId: auditRef.id,
      workspaceId,
      actorUid: user.uid,
      actorName: user.displayName ?? user.email ?? '',
      action: 'entry.confirm',
      entityType: 'ledgerEntry',
      entityId: entryId,
      entityLabel: voucherNumber,
      beforeSummary: { status: ENTRY_STATUS.DRAFT, voucherNumber: null },
      afterSummary: {
        status: ENTRY_STATUS.CONFIRMED,
        voucherNumber,
        amountPaise: entry.amountPaise,
        ledgerDate: entry.ledgerDate,
        type: entry.type,
      },
      reason: null,
      requestId: entry.clientRequestId ?? null,
      // Device details only — no IP address and no location. An audit trail
      // needs to identify the action, not to track the person.
      sessionMeta: {
        userAgent: navigator.userAgent.slice(0, 200),
        platform: navigator.platform ?? '',
      },
      serverTimestamp: serverTimestamp(),
    });

    return { voucherNumber, alreadyConfirmed: false };
  }).catch((error) => {
    if (error instanceof ConfirmError) throw error;

    // A permission-denied here almost always means a rule caught something
    // the client thought was fine. Say so plainly rather than showing the
    // raw Firebase text, which is unhelpful to a bookkeeper.
    if (error?.code === 'permission-denied') {
      throw new ConfirmError(
        ERROR_CODE.INSUFFICIENT_ROLE,
        'The server refused this confirmation. Your role may not allow it, or the date may have just been locked.',
      );
    }

    if (error?.code === 'aborted' || error?.code === 'failed-precondition') {
      throw new ConfirmError(
        ERROR_CODE.CONFLICT,
        'Someone else was confirming at the same moment. Try again.',
      );
    }

    console.error('[PMExps] Confirmation failed', error);
    throw new ConfirmError(ERROR_CODE.INTERNAL, 'Could not confirm the entry. Try again.');
  });
}

/**
 * Confirm several drafts, one transaction each.
 *
 * Deliberately sequential rather than parallel: two transactions touching the
 * same counter at once would collide and retry, and running them in order
 * keeps voucher numbers in the order the user saw on screen.
 *
 * @param {string} workspaceId
 * @param {string[]} entryIds
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<{confirmed: string[], failed: Array<{entryId: string, message: string}>}>}
 */
export async function confirmMany(workspaceId, entryIds, onProgress) {
  /** @type {string[]} */
  const confirmed = [];
  /** @type {Array<{entryId: string, message: string}>} */
  const failed = [];

  for (const [index, entryId] of entryIds.entries()) {
    try {
      const result = await confirmEntry({ workspaceId, entryId });
      confirmed.push(result.voucherNumber);
    } catch (error) {
      failed.push({ entryId, message: error?.message ?? 'Failed' });
    }
    onProgress?.(index + 1, entryIds.length);
  }

  return { confirmed, failed };
}
