/**
 * PMExps — Transfers
 *
 * Moving money between your own accounts. Not income, not expense — the total
 * you hold does not change, only where it sits.
 *
 * A confirmed transfer is three documents written in one transaction:
 *
 *   transfers/{id}                  the record a person reads
 *   ledgerEntries/{outId}           leaves the source account
 *   ledgerEntries/{inId}            arrives in the destination account
 *
 * plus the TRF counter and an audit row. All five commit together or none do.
 *
 * The two legs must agree exactly on amount, date and transfer ID, and point
 * in opposite directions. That is not merely what this code writes — it is
 * what firestore.rules requires, using getAfter() to inspect both legs before
 * allowing the commit. A half-written transfer, which would silently create
 * or destroy money, cannot be stored even by a client that tries.
 *
 * @module services/transfers
 */

import { db, firestore } from '../firebase/init.js';
import { currentUser } from './auth.js';
import { formatVoucher, counterFor } from '../utils/voucher.js';
import { isDateLocked, financialYear } from '../utils/dates.js';
import { assertPaise } from '../utils/money.js';
import { ENTRY_STATUS, TRANSFER_STATUS, TRANSFER_LEG, ERROR_CODE, PAYMENT_MODE } from '../config/constants.js';
import { newRequestId } from '../repositories/entries.js';

const { doc, collection, runTransaction, getDocs, query, orderBy, limit, serverTimestamp } = firestore;

/** Error with a stable code. */
export class TransferError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'TransferError';
    this.code = code;
  }
}

/**
 * Validate a transfer before any write is attempted.
 * @param {Record<string, any>} input
 * @param {any[]} accounts
 * @param {string|null} lockDate
 * @returns {{valid: boolean, errors: Record<string, string>}}
 */
export function validateTransfer(input, accounts, lockDate) {
  /** @type {Record<string, string>} */
  const errors = {};

  const from = accounts.find((a) => a.accountId === input.fromAccountId);
  const to = accounts.find((a) => a.accountId === input.toAccountId);

  if (!input.fromAccountId) errors.fromAccountId = 'Choose the account money leaves.';
  else if (!from) errors.fromAccountId = 'That account is not in this workspace.';
  else if (!from.isActive) errors.fromAccountId = 'That account is inactive.';

  if (!input.toAccountId) errors.toAccountId = 'Choose the account money arrives in.';
  else if (!to) errors.toAccountId = 'That account is not in this workspace.';
  else if (!to.isActive) errors.toAccountId = 'That account is inactive.';

  // The single most important check on this form. Without it a transfer to
  // the same account would write two legs that cancel out, leaving a pair of
  // meaningless rows in the ledger for every account statement to explain.
  if (input.fromAccountId && input.fromAccountId === input.toAccountId) {
    errors.toAccountId = 'Choose a different account. Money cannot move to where it already is.';
  }

  try {
    assertPaise(input.amountPaise, { field: 'Amount' });
  } catch {
    errors.amountPaise = 'Enter an amount greater than zero.';
  }

  if (!input.ledgerDate) errors.ledgerDate = 'Choose a date.';
  else if (isDateLocked(input.ledgerDate, lockDate)) {
    errors.ledgerDate = `That date is in a closed period (locked up to ${lockDate}).`;
  }

  const description = String(input.description ?? '').trim();
  if (description.length < 1) errors.description = 'Write a short description.';
  else if (description.length > 200) errors.description = 'Keep it under 200 characters.';

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Create and confirm a transfer in one transaction.
 *
 * There is no draft step. A transfer that exists but has not moved anything
 * is a trap: it looks like a record of money moving while the balances say
 * otherwise. Either the money moved or it did not.
 *
 * @param {object} input
 * @param {string} input.workspaceId
 * @param {string} input.fromAccountId
 * @param {string} input.toAccountId
 * @param {number} input.amountPaise
 * @param {string} input.ledgerDate
 * @param {string} input.description
 * @param {string} [input.referenceNumber]
 * @param {string} [input.remarks]
 * @param {any[]} input.accounts
 * @param {string} [input.clientRequestId]
 * @returns {Promise<{transferId: string, voucherNumber: string}>}
 */
export async function createTransfer(input) {
  const user = currentUser();
  if (!user) throw new TransferError(ERROR_CODE.UNAUTHENTICATED, 'Sign in first.');

  const { workspaceId, accounts } = input;
  const from = accounts.find((a) => a.accountId === input.fromAccountId);
  const to = accounts.find((a) => a.accountId === input.toAccountId);

  if (!from || !to) {
    throw new TransferError(ERROR_CODE.VALIDATION_FAILED, 'Choose both accounts.');
  }
  if (from.accountId === to.accountId) {
    throw new TransferError(ERROR_CODE.SAME_ACCOUNT_TRANSFER, 'Source and destination must differ.');
  }

  assertPaise(input.amountPaise, { field: 'Amount' });

  const transferRef = doc(collection(db, 'workspaces', workspaceId, 'transfers'));
  const outRef = doc(collection(db, 'workspaces', workspaceId, 'ledgerEntries'));
  const inRef = doc(collection(db, 'workspaces', workspaceId, 'ledgerEntries'));
  const requestId = input.clientRequestId ?? newRequestId();
  const fyToken = financialYear(input.ledgerDate).token;

  return runTransaction(db, async (tx) => {
    // Lock date is read inside the transaction, not before, so a period
    // closing mid-operation cannot be raced.
    const settingsSnapshot = await tx.get(
      doc(db, 'workspaces', workspaceId, 'settings', 'accounting'),
    );
    const lockDate = settingsSnapshot.exists() ? (settingsSnapshot.data().lockDate ?? null) : null;

    if (isDateLocked(input.ledgerDate, lockDate)) {
      throw new TransferError(
        ERROR_CODE.DATE_LOCKED,
        `${input.ledgerDate} is in a closed period. Use a later date.`,
      );
    }

    const { counterId, prefix, yearToken } = counterFor('transfer', input.ledgerDate);
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

    // ---- The transfer record, created already draft then confirmed in the
    // same commit, because the rules require a draft-to-confirmed transition
    // and getAfter() on both legs. Writing it once as 'confirmed' would have
    // no prior state for the rule to compare against.
    tx.set(transferRef, {
      transferId: transferRef.id,
      workspaceId,
      voucherNumber: null,
      ledgerDate: input.ledgerDate,
      financialYear: fyToken,
      fromAccountId: from.accountId,
      fromAccountNameSnapshot: from.name,
      toAccountId: to.accountId,
      toAccountNameSnapshot: to.name,
      amountPaise: input.amountPaise,
      referenceNumber: emptyToNull(input.referenceNumber),
      description: String(input.description).trim(),
      remarks: emptyToNull(input.remarks),
      status: TRANSFER_STATUS.DRAFT,
      outEntryId: null,
      inEntryId: null,
      reversalOfTransferId: null,
      reversedByTransferId: null,
      clientRequestId: requestId,
      createdBy: user.uid,
      confirmedBy: null,
      confirmedAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    tx.update(transferRef, {
      status: TRANSFER_STATUS.CONFIRMED,
      voucherNumber,
      outEntryId: outRef.id,
      inEntryId: inRef.id,
      confirmedBy: user.uid,
      confirmedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const legBase = {
      workspaceId,
      voucherNumber,
      ledgerDate: input.ledgerDate,
      financialYear: fyToken,
      categoryId: '',
      categoryNameSnapshot: 'Account transfer',
      description: String(input.description).trim(),
      partyName: null,
      paymentMode: PAYMENT_MODE.BANK_TRANSFER,
      amountPaise: input.amountPaise,
      referenceNumber: emptyToNull(input.referenceNumber),
      remarks: emptyToNull(input.remarks),
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
      reversalOf: null,
      correctionRequestId: null,
      transferId: transferRef.id,
      clientRequestId: requestId,
      isSynced: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    // The leg types are cosmetic — balance maths reads transferLeg, never
    // type — but they keep the ledger readable: money leaving looks like an
    // outflow in the row, money arriving looks like an inflow.
    tx.set(outRef, {
      ...legBase,
      entryId: outRef.id,
      type: 'expense',
      transferLeg: TRANSFER_LEG.OUT,
      accountId: from.accountId,
      accountNameSnapshot: from.name,
    });

    tx.set(inRef, {
      ...legBase,
      entryId: inRef.id,
      type: 'income',
      transferLeg: TRANSFER_LEG.IN,
      accountId: to.accountId,
      accountNameSnapshot: to.name,
    });

    const auditRef = doc(db, 'workspaces', workspaceId, 'auditLogs', `${transferRef.id}-create`);
    tx.set(auditRef, {
      auditId: auditRef.id,
      workspaceId,
      actorUid: user.uid,
      actorName: user.displayName ?? user.email ?? '',
      action: 'transfer.confirm',
      entityType: 'transfer',
      entityId: transferRef.id,
      entityLabel: voucherNumber,
      beforeSummary: null,
      afterSummary: {
        amountPaise: input.amountPaise,
        from: from.name,
        to: to.name,
        ledgerDate: input.ledgerDate,
      },
      reason: null,
      requestId,
      sessionMeta: { userAgent: navigator.userAgent.slice(0, 200) },
      serverTimestamp: serverTimestamp(),
    });

    return { transferId: transferRef.id, voucherNumber };
  }).catch((error) => {
    if (error instanceof TransferError) throw error;

    if (error?.code === 'permission-denied') {
      throw new TransferError(
        ERROR_CODE.INSUFFICIENT_ROLE,
        'The server refused this transfer. The two legs must balance exactly, the date must be open, and your role must allow entries.',
      );
    }
    if (error?.code === 'aborted' || error?.code === 'failed-precondition') {
      throw new TransferError(ERROR_CODE.CONFLICT, 'Someone else was writing at the same moment. Try again.');
    }

    console.error('[PMExps] Transfer failed', error);
    throw new TransferError(ERROR_CODE.INTERNAL, 'Could not record the transfer. Try again.');
  });
}

/**
 * Recent transfers.
 * @param {string} workspaceId
 * @param {number} [count]
 * @returns {Promise<any[]>}
 */
export async function listTransfers(workspaceId, count = 50) {
  const snapshot = await getDocs(
    query(
      collection(db, 'workspaces', workspaceId, 'transfers'),
      orderBy('ledgerDate', 'desc'),
      limit(count),
    ),
  );
  return snapshot.docs.map((d) => d.data());
}

/** @param {unknown} value @returns {string|null} */
function emptyToNull(value) {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
}
