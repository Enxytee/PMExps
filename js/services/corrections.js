/**
 * PMExps — Corrections
 *
 * A confirmed entry cannot be edited. That is the whole point of confirming
 * one. But people make mistakes, so there has to be a way to put them right
 * that does not involve quietly rewriting history.
 *
 * The process:
 *
 *   1. Someone requests a correction and must give a reason.
 *   2. A Super Admin reviews the original against what is proposed.
 *   3. Approving writes a REVERSAL — a new confirmed entry carrying the same
 *      type and amount as the original, flagged as reversing it. The two
 *      cancel out. The original stays exactly as it was, now pointing at the
 *      reversal that undid it.
 *   4. The corrected figures come back as a fresh DRAFT, linked to the
 *      original, which is confirmed normally and gets its own voucher number.
 *
 * Nothing is edited. Nothing is deleted. A reader can follow the chain from
 * the original, to the reversal, to the replacement, with a reason attached.
 *
 * Why the reversal carries the same type rather than the opposite one:
 * reversing ₹100 of income by recording ₹100 of expense would leave account
 * balances correct while inflating the expense total, and every
 * category report would quietly disagree with reality. The sign is flipped in
 * the balance calculation instead, where it affects the balance and nothing
 * else.
 *
 * @module services/corrections
 */

import { db, firestore } from '../firebase/init.js';
import { currentUser } from './auth.js';
import { formatVoucher, counterFor } from '../utils/voucher.js';
import { financialYear } from '../utils/dates.js';
import { ENTRY_STATUS, CORRECTION_STATUS, ERROR_CODE } from '../config/constants.js';
import { newRequestId } from '../repositories/entries.js';
import { createTransfer } from './transfers.js';
import { requireOnline } from './connectivity.js';

const {
  doc, collection, getDoc, getDocs, query, where, orderBy, limit,
  runTransaction, setDoc, updateDoc, serverTimestamp,
} = firestore;

/** Error with a stable code. */
export class CorrectionError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'CorrectionError';
    this.code = code;
  }
}

/** Fields a correction may propose changing. */
const CORRECTABLE_FIELDS = [
  'amountPaise',
  'ledgerDate',
  'description',
  'categoryId',
  'accountId',
  'partyName',
  'paymentMode',
  'referenceNumber',
  'remarks',
];

/**
 * Ask for a confirmed entry to be corrected.
 *
 * @param {object} input
 * @param {string} input.workspaceId
 * @param {string} input.entryId
 * @param {Record<string, any>} input.proposed the corrected values
 * @param {string} input.reason
 * @returns {Promise<string>} the request ID
 */
export async function requestCorrection({ workspaceId, entryId, proposed, reason }) {
  const user = currentUser();
  if (!user) throw new CorrectionError(ERROR_CODE.UNAUTHENTICATED, 'Sign in first.');

  const trimmedReason = String(reason ?? '').trim();
  if (trimmedReason.length < 10) {
    throw new CorrectionError(
      ERROR_CODE.VALIDATION_FAILED,
      'Give a reason of at least 10 characters. It stays on the record permanently.',
    );
  }

  const entrySnapshot = await getDoc(
    doc(db, 'workspaces', workspaceId, 'ledgerEntries', entryId),
  );
  if (!entrySnapshot.exists()) {
    throw new CorrectionError(ERROR_CODE.NOT_FOUND, 'That entry no longer exists.');
  }

  const entry = entrySnapshot.data();

  if (entry.status === ENTRY_STATUS.DRAFT) {
    throw new CorrectionError(
      ERROR_CODE.VALIDATION_FAILED,
      'That entry is still a draft — edit it directly instead of requesting a correction.',
    );
  }
  if (entry.correctedBy) {
    throw new CorrectionError(
      ERROR_CODE.VALIDATION_FAILED,
      'That entry has already been corrected.',
    );
  }

  const requestRef = doc(collection(db, 'workspaces', workspaceId, 'correctionRequests'));

  /** @type {Record<string, any>} */
  const originalSummary = {};
  /** @type {Record<string, any>} */
  const proposedSummary = {};

  for (const key of CORRECTABLE_FIELDS) {
    originalSummary[key] = entry[key] ?? null;
    proposedSummary[key] = proposed?.[key] ?? entry[key] ?? null;
  }

  await setDoc(requestRef, {
    requestId: requestRef.id,
    workspaceId,
    targetType: 'ledgerEntry',
    targetId: entryId,
    targetVoucherNumber: entry.voucherNumber ?? '',
    originalSummary,
    proposedSummary,
    reason: trimmedReason,
    status: CORRECTION_STATUS.PENDING,
    requestedBy: user.uid,
    requestedByName: user.displayName ?? user.email ?? '',
    requestedAt: serverTimestamp(),
    reviewedBy: null,
    reviewedByName: null,
    reviewedAt: null,
    reviewNote: null,
    reversalEntryId: null,
    replacementEntryId: null,
    clientRequestId: newRequestId(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return requestRef.id;
}

/**
 * Approve a correction: write the reversal, mark the original, and hand back
 * a corrected draft.
 *
 * The reversal and the original's marking commit together. The replacement
 * draft is created afterwards, deliberately: it needs its own voucher number
 * from the income or expense counter, and a counter may only advance by one
 * per transaction. Splitting it means both documents get a correct number
 * through the ordinary confirmation path rather than a special case.
 *
 * @param {object} input
 * @param {string} input.workspaceId
 * @param {string} input.requestId
 * @returns {Promise<{reversalVoucher: string, replacementEntryId: string|null}>}
 */
export async function approveCorrection({ workspaceId, requestId }) {
  const user = currentUser();
  if (!user) throw new CorrectionError(ERROR_CODE.UNAUTHENTICATED, 'Sign in first.');

  // Writes a reversal with a voucher number from the COR counter.
  requireOnline('Approving a correction');

  const requestRef = doc(db, 'workspaces', workspaceId, 'correctionRequests', requestId);

  const { reversalVoucher, entry, request } = await runTransaction(db, async (tx) => {
    const requestSnapshot = await tx.get(requestRef);
    if (!requestSnapshot.exists()) {
      throw new CorrectionError(ERROR_CODE.NOT_FOUND, 'That request no longer exists.');
    }

    const req = requestSnapshot.data();
    if (req.status !== CORRECTION_STATUS.PENDING) {
      throw new CorrectionError(
        ERROR_CODE.INVALID_TRANSITION,
        `That request was already ${req.status}.`,
      );
    }

    const entryRef = doc(db, 'workspaces', workspaceId, 'ledgerEntries', req.targetId);
    const entrySnapshot = await tx.get(entryRef);
    if (!entrySnapshot.exists()) {
      throw new CorrectionError(ERROR_CODE.NOT_FOUND, 'The entry no longer exists.');
    }

    const original = entrySnapshot.data();
    if (original.correctedBy) {
      throw new CorrectionError(
        ERROR_CODE.VALIDATION_FAILED,
        'That entry has already been corrected.',
      );
    }

    // ---- COR counter ---------------------------------------------------
    const { counterId, prefix, yearToken } = counterFor('correction', original.ledgerDate);
    const counterRef = doc(db, 'workspaces', workspaceId, 'voucherCounters', counterId);
    const counterSnapshot = await tx.get(counterRef);
    const nextNumber = (counterSnapshot.exists() ? (counterSnapshot.data().lastNumber ?? 0) : 0) + 1;
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

    // ---- The reversal ---------------------------------------------------
    // Same type, same amount, same account, same date as the original. Only
    // reversalOf marks it as an undo, and only the balance code acts on that.
    const reversalRef = doc(collection(db, 'workspaces', workspaceId, 'ledgerEntries'));

    tx.set(reversalRef, {
      entryId: reversalRef.id,
      workspaceId,
      voucherNumber,
      ledgerDate: original.ledgerDate,
      financialYear: original.financialYear,
      type: original.type,
      categoryId: original.categoryId,
      categoryNameSnapshot: original.categoryNameSnapshot,
      accountId: original.accountId,
      accountNameSnapshot: original.accountNameSnapshot,
      description: `Reversal of ${original.voucherNumber}: ${original.description}`,
      partyName: original.partyName ?? null,
      paymentMode: original.paymentMode,
      amountPaise: original.amountPaise,
      referenceNumber: original.voucherNumber,
      remarks: req.reason,
      attachments: [],
      status: ENTRY_STATUS.CONFIRMED,
      enteredBy: user.uid,
      enteredByName: user.displayName ?? user.email ?? '',
      confirmedBy: user.uid,
      confirmedByName: user.displayName ?? user.email ?? '',
      confirmedAt: serverTimestamp(),
      lockedBy: null,
      lockedAt: null,
      correctionOf: null,
      correctedBy: null,
      reversalOf: original.entryId,
      correctionRequestId: requestId,
      transferId: null,
      transferLeg: null,
      clientRequestId: req.clientRequestId ?? newRequestId(),
      isSynced: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // ---- Mark the original ----------------------------------------------
    tx.update(entryRef, {
      correctedBy: reversalRef.id,
      correctionRequestId: requestId,
      updatedAt: serverTimestamp(),
    });

    // ---- Close the request ----------------------------------------------
    tx.update(requestRef, {
      status: CORRECTION_STATUS.APPROVED,
      reviewedBy: user.uid,
      reviewedByName: user.displayName ?? user.email ?? '',
      reviewedAt: serverTimestamp(),
      reversalEntryId: reversalRef.id,
      updatedAt: serverTimestamp(),
    });

    // ---- Audit ------------------------------------------------------------
    const auditRef = doc(db, 'workspaces', workspaceId, 'auditLogs', `${requestId}-approve`);
    tx.set(auditRef, {
      auditId: auditRef.id,
      workspaceId,
      actorUid: user.uid,
      actorName: user.displayName ?? user.email ?? '',
      action: 'correction.approve',
      entityType: 'ledgerEntry',
      entityId: original.entryId,
      entityLabel: original.voucherNumber ?? '',
      beforeSummary: req.originalSummary ?? null,
      afterSummary: req.proposedSummary ?? null,
      reason: req.reason,
      requestId,
      sessionMeta: { userAgent: navigator.userAgent.slice(0, 200) },
      serverTimestamp: serverTimestamp(),
    });

    return { reversalVoucher: voucherNumber, entry: original, request: req };
  }).catch((error) => {
    if (error instanceof CorrectionError) throw error;
    if (error?.code === 'permission-denied') {
      throw new CorrectionError(
        ERROR_CODE.INSUFFICIENT_ROLE,
        'The server refused this correction. Only a Super Admin may approve one.',
      );
    }
    console.error('[PMExps] Correction failed', error);
    throw new CorrectionError(ERROR_CODE.INTERNAL, 'Could not approve the correction.');
  });

  // ---- The corrected replacement, as an ordinary draft --------------------
  const proposed = request.proposedSummary ?? {};
  const replacementRef = doc(collection(db, 'workspaces', workspaceId, 'ledgerEntries'));

  await setDoc(replacementRef, {
    entryId: replacementRef.id,
    workspaceId,
    voucherNumber: null,
    ledgerDate: proposed.ledgerDate ?? entry.ledgerDate,
    financialYear: financialYear(proposed.ledgerDate ?? entry.ledgerDate).token,
    type: entry.type,
    categoryId: proposed.categoryId ?? entry.categoryId,
    categoryNameSnapshot: entry.categoryNameSnapshot,
    accountId: proposed.accountId ?? entry.accountId,
    accountNameSnapshot: entry.accountNameSnapshot,
    description: proposed.description ?? entry.description,
    partyName: proposed.partyName ?? null,
    paymentMode: proposed.paymentMode ?? entry.paymentMode,
    amountPaise: proposed.amountPaise ?? entry.amountPaise,
    referenceNumber: proposed.referenceNumber ?? null,
    remarks: proposed.remarks ?? null,
    attachments: [],
    status: ENTRY_STATUS.DRAFT,
    enteredBy: user.uid,
    enteredByName: user.displayName ?? user.email ?? '',
    confirmedBy: null,
    confirmedByName: null,
    confirmedAt: null,
    lockedBy: null,
    lockedAt: null,
    correctionOf: entry.entryId,
    correctedBy: null,
    reversalOf: null,
    correctionRequestId: requestId,
    transferId: null,
    transferLeg: null,
    clientRequestId: newRequestId(),
    isSynced: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await updateDoc(requestRef, {
    replacementEntryId: replacementRef.id,
    updatedAt: serverTimestamp(),
  });

  return { reversalVoucher, replacementEntryId: replacementRef.id };
}

/**
 * Reject a correction request, with a note explaining why.
 * @param {object} input
 * @param {string} input.workspaceId
 * @param {string} input.requestId
 * @param {string} input.note
 * @returns {Promise<void>}
 */
export async function rejectCorrection({ workspaceId, requestId, note }) {
  const user = currentUser();
  if (!user) throw new CorrectionError(ERROR_CODE.UNAUTHENTICATED, 'Sign in first.');

  await updateDoc(doc(db, 'workspaces', workspaceId, 'correctionRequests', requestId), {
    status: CORRECTION_STATUS.REJECTED,
    reviewedBy: user.uid,
    reviewedByName: user.displayName ?? user.email ?? '',
    reviewedAt: serverTimestamp(),
    reviewNote: String(note ?? '').trim() || null,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Reverse a confirmed transfer by recording the opposite transfer.
 *
 * Deliberately not a "delete" or an edit. The original stays in the ledger
 * with its own voucher number, and a second transfer moves the money back,
 * linked to it. Both appear on an account statement, which is what actually
 * happened.
 *
 * @param {object} input
 * @param {string} input.workspaceId
 * @param {string} input.transferId
 * @param {string} input.reason
 * @param {any[]} input.accounts
 * @returns {Promise<{voucherNumber: string}>}
 */
export async function reverseTransfer({ workspaceId, transferId, reason, accounts }) {
  const user = currentUser();
  if (!user) throw new CorrectionError(ERROR_CODE.UNAUTHENTICATED, 'Sign in first.');

  const trimmedReason = String(reason ?? '').trim();
  if (trimmedReason.length < 10) {
    throw new CorrectionError(
      ERROR_CODE.VALIDATION_FAILED,
      'Give a reason of at least 10 characters. It stays on the record.',
    );
  }

  const originalSnapshot = await getDoc(
    doc(db, 'workspaces', workspaceId, 'transfers', transferId),
  );
  if (!originalSnapshot.exists()) {
    throw new CorrectionError(ERROR_CODE.NOT_FOUND, 'That transfer no longer exists.');
  }

  const original = originalSnapshot.data();
  if (original.reversedByTransferId) {
    throw new CorrectionError(ERROR_CODE.VALIDATION_FAILED, 'That transfer was already reversed.');
  }

  // Reversing a reversal is refused. It would balance out correctly but leave
  // an ever-growing chain of cancelling pairs on the account statement, and
  // the intent — "this movement should not have happened" — is already on
  // record from the first reversal.
  //
  // Checked two ways for the same reason as in the view: the forward marker
  // is absent on anything reversed before that field existed, but the
  // original always points at its reversal, so the query below catches those
  // too without touching stored data.
  if (original.reversalOfTransferId) {
    throw new CorrectionError(
      ERROR_CODE.VALIDATION_FAILED,
      'That entry is itself a reversal, so it cannot be reversed again. Record a new transfer instead.',
    );
  }

  const pointingHere = await getDocs(
    query(
      collection(db, 'workspaces', workspaceId, 'transfers'),
      where('reversedByTransferId', '==', transferId),
      limit(1),
    ),
  );

  if (!pointingHere.empty) {
    throw new CorrectionError(
      ERROR_CODE.VALIDATION_FAILED,
      'That entry is itself a reversal, so it cannot be reversed again. Record a new transfer instead.',
    );
  }

  // The reverse transfer swaps the two accounts and reuses the proven
  // transfer path, so the same balancing guarantees apply to the undo as to
  // the original.
  const result = await createTransfer({
    workspaceId,
    fromAccountId: original.toAccountId,
    toAccountId: original.fromAccountId,
    amountPaise: original.amountPaise,
    ledgerDate: original.ledgerDate,
    description: `Reversal of ${original.voucherNumber}: ${original.description}`,
    referenceNumber: original.voucherNumber,
    remarks: trimmedReason,
    accounts,
    reversalOfTransferId: transferId,
  });

  await updateDoc(doc(db, 'workspaces', workspaceId, 'transfers', transferId), {
    reversedByTransferId: result.transferId,
    status: 'reversed',
    updatedAt: serverTimestamp(),
  });

  return { voucherNumber: result.voucherNumber };
}

/**
 * Correction requests, newest first.
 * @param {string} workspaceId
 * @param {{ status?: string }} [options]
 * @returns {Promise<any[]>}
 */
export async function listCorrections(workspaceId, options = {}) {
  const constraints = [];
  if (options.status) constraints.push(where('status', '==', options.status));
  constraints.push(orderBy('requestedAt', 'desc'), limit(50));

  const snapshot = await getDocs(
    query(collection(db, 'workspaces', workspaceId, 'correctionRequests'), ...constraints),
  );
  return snapshot.docs.map((d) => d.data());
}
