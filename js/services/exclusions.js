/**
 * PMExps — Excluding an entry from the books
 *
 * For practice data, a duplicate, or an entry recorded against the wrong
 * workspace: something that should never have been in the accounts at all.
 *
 * What this is NOT is a delete. The entry stays in the ledger, marked, and
 * the count of excluded entries is shown permanently. Only its effect on the
 * arithmetic is removed.
 *
 * That line matters. A flag that hid an entry completely would be deletion
 * with a friendlier name: an awkward expense could vanish with one click and
 * nobody reading the ledger would know anything was missing. Visible but
 * uncounted serves the honest purpose — clearing practice data — while being
 * useless for concealment.
 *
 * For a real transaction recorded with the wrong figures, this is the wrong
 * tool. Use a correction: it keeps the original, writes a reversal, and
 * produces the right entry.
 *
 * @module services/exclusions
 */

import { db, firestore } from '../firebase/init.js';
import { currentUser } from './auth.js';
import { requireOnline } from './connectivity.js';
import { ERROR_CODE } from '../config/constants.js';

const { doc, collection, getDoc, runTransaction, serverTimestamp } = firestore;

/** Error with a stable code. */
export class ExclusionError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'ExclusionError';
    this.code = code;
  }
}

/**
 * Exclude an entry from the books, or put it back.
 *
 * The entry and its audit row commit together, so an exclusion can never
 * happen without a record of who did it and why.
 *
 * @param {object} input
 * @param {string} input.workspaceId
 * @param {string} input.entryId
 * @param {boolean} input.excluded
 * @param {string} input.reason
 * @returns {Promise<void>}
 */
export async function setExcluded({ workspaceId, entryId, excluded, reason }) {
  const user = currentUser();
  if (!user) throw new ExclusionError(ERROR_CODE.UNAUTHENTICATED, 'Sign in first.');

  requireOnline(excluded ? 'Excluding an entry' : 'Restoring an entry');

  const trimmedReason = String(reason ?? '').trim();
  if (trimmedReason.length < 10) {
    throw new ExclusionError(
      ERROR_CODE.VALIDATION_FAILED,
      'Give a reason of at least 10 characters. It stays on the record permanently.',
    );
  }

  const entryRef = doc(db, 'workspaces', workspaceId, 'ledgerEntries', entryId);

  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(entryRef);
    if (!snapshot.exists()) {
      throw new ExclusionError(ERROR_CODE.NOT_FOUND, 'That entry no longer exists.');
    }

    const entry = snapshot.data();

    if ((entry.excludedFromBooks === true) === excluded) {
      throw new ExclusionError(
        ERROR_CODE.VALIDATION_FAILED,
        excluded ? 'That entry is already excluded.' : 'That entry is already in the books.',
      );
    }

    // A transfer leg cannot be excluded on its own: removing one side of a
    // balanced pair would create money out of nothing. Reverse the transfer
    // instead, which handles both legs together.
    if (entry.transferId) {
      throw new ExclusionError(
        ERROR_CODE.VALIDATION_FAILED,
        'This is one leg of a transfer. Excluding one side alone would unbalance the books — reverse the transfer instead.',
      );
    }

    tx.update(entryRef, {
      excludedFromBooks: excluded,
      excludeReason: excluded ? trimmedReason : null,
      excludedBy: excluded ? user.uid : null,
      excludedAt: excluded ? serverTimestamp() : null,
      updatedAt: serverTimestamp(),
    });

    const auditRef = doc(collection(db, 'workspaces', workspaceId, 'auditLogs'));
    tx.set(auditRef, {
      auditId: auditRef.id,
      workspaceId,
      actorUid: user.uid,
      actorName: user.displayName ?? user.email ?? '',
      action: excluded ? 'entry.exclude' : 'entry.restore',
      entityType: 'ledgerEntry',
      entityId: entryId,
      entityLabel: entry.voucherNumber ?? entry.description ?? '',
      beforeSummary: {
        excludedFromBooks: entry.excludedFromBooks === true,
        amountPaise: entry.amountPaise,
        type: entry.type,
      },
      afterSummary: { excludedFromBooks: excluded },
      reason: trimmedReason,
      requestId: null,
      sessionMeta: { userAgent: navigator.userAgent.slice(0, 200) },
      serverTimestamp: serverTimestamp(),
    });
  }).catch((error) => {
    if (error instanceof ExclusionError) throw error;
    if (error?.code === 'permission-denied') {
      throw new ExclusionError(
        ERROR_CODE.INSUFFICIENT_ROLE,
        'The server refused this. Only a Super Admin can exclude an entry, and the period must not be closed.',
      );
    }
    console.error('[PMExps] Exclusion failed', error);
    throw new ExclusionError(ERROR_CODE.INTERNAL, 'Could not change the entry.');
  });
}
