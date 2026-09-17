/**
 * PMExps — Corrections: request, review, approve
 * @module views/corrections
 */

import { el } from '../utils/dom.js';
import { renderPage, pageHeader, goTo } from '../components/shell.js';
import { field, textArea, moneyInput, textInput, dateInput, select, toast, setBusy, setFormError, confirmDialog } from '../components/ui.js';
import { getState, selectableCategories, selectableAccounts, refreshMasterData } from '../state.js';
import {
  requestCorrection, approveCorrection, rejectCorrection,
  reverseTransfer, listCorrections,
} from '../services/corrections.js';
import { listTransfers } from '../services/transfers.js';
import { getEntry } from '../repositories/entries.js';
import { formatPaise } from '../utils/money.js';
import { formatLedgerDate, formatTimestamp } from '../utils/dates.js';
import { ROLE, CORRECTION_STATUS } from '../config/constants.js';

/* -------------------------------------------------------------------------
   Request a correction for one entry
   ------------------------------------------------------------------------- */

/** @param {import('../router.js').RouteContext} context */
export async function renderCorrectionRequest(context) {
  await refreshMasterData();
  const { workspaceId } = getState();
  const entryId = context.params.entryId;
  const entry = await getEntry(workspaceId, entryId);

  if (!entry) {
    renderPage(
      pageHeader({ title: 'Entry not found' }),
      el('div', { class: 'alert alert--warning' }, 'That entry no longer exists.'),
      el('button', { class: 'btn', type: 'button', onClick: () => goTo('/ledger') }, 'Back to ledger'),
    );
    return;
  }

  const proposed = {
    amountPaise: entry.amountPaise,
    ledgerDate: entry.ledgerDate,
    description: entry.description,
    categoryId: entry.categoryId,
    accountId: entry.accountId,
    partyName: entry.partyName ?? '',
    referenceNumber: entry.referenceNumber ?? '',
    remarks: entry.remarks ?? '',
  };
  let reason = '';

  function draw() {
    const errorBox = el('div', {});
    const submit = el('button', { class: 'btn btn--primary', type: 'submit' }, 'Request correction');

    async function onSubmit(event) {
      event.preventDefault();
      setFormError(errorBox, null);
      const restore = setBusy(submit, 'Sending…');
      try {
        await requestCorrection({ workspaceId, entryId, proposed, reason });
        toast('Correction requested. A Super Admin will review it.');
        goTo('/corrections');
      } catch (error) {
        setFormError(errorBox, error?.message ?? 'Could not send the request.');
        restore();
      }
    }

    renderPage(
      pageHeader({
        title: 'Request a correction',
        subtitle: `${entry.voucherNumber ?? ''} · ${entry.description}`,
        actions: [el('button', { class: 'btn', type: 'button', onClick: () => goTo('/ledger') }, 'Cancel')],
      }),

      el(
        'div',
        { class: 'alert alert--info' },
        'The original entry is never changed. If this is approved, a reversal is written that cancels it out, and the corrected figures come back as a draft for you to confirm. Both stay on the record, with your reason attached.',
      ),

      el(
        'section',
        { class: 'card stack stack--tight' },
        el('h2', { class: 'u-text-md' }, 'Current values'),
        row('Amount', formatPaise(entry.amountPaise)),
        row('Date', formatLedgerDate(entry.ledgerDate)),
        row('Category', entry.categoryNameSnapshot),
        row('Account', entry.accountNameSnapshot),
        row('Description', entry.description),
      ),

      el(
        'form',
        { class: 'stack form-page', novalidate: true, onSubmit },
        el('h2', {}, 'Corrected values'),

        field({
          label: 'Amount',
          control: moneyInput({
            paise: proposed.amountPaise,
            onValue: (value) => { if (value !== 'invalid' && value !== null) proposed.amountPaise = value; },
          }),
        }),
        field({
          label: 'Date',
          control: dateInput({ value: proposed.ledgerDate, onChange: (v) => { proposed.ledgerDate = v; } }),
        }),
        field({
          label: 'Category',
          control: select({
            value: proposed.categoryId,
            options: selectableCategories(entry.type).map((c) => ({ value: c.categoryId, label: c.name })),
            onChange: (v) => { proposed.categoryId = v; },
          }),
        }),
        field({
          label: 'Account',
          control: select({
            value: proposed.accountId,
            options: selectableAccounts().map((a) => ({ value: a.accountId, label: a.name })),
            onChange: (v) => { proposed.accountId = v; },
          }),
        }),
        field({
          label: 'Description',
          control: textInput({
            value: proposed.description,
            maxlength: 200,
            onInput: (v) => { proposed.description = v; },
          }),
        }),
        field({
          label: 'Reason for the correction',
          required: true,
          control: textArea({
            maxlength: 500,
            placeholder: 'Amount entered as 500 instead of 5000 — invoice attached',
            onInput: (v) => { reason = v; },
          }),
          hint: 'At least 10 characters. Stored permanently and shown in the audit log.',
        }),

        errorBox,
        submit,
      ),
    );
  }

  draw();
}

function row(label, value) {
  return el(
    'div',
    { class: 'row row--between u-text-sm' },
    el('span', { class: 'u-text-muted' }, label),
    el('span', {}, String(value)),
  );
}

/* -------------------------------------------------------------------------
   Review queue
   ------------------------------------------------------------------------- */

export async function renderCorrections() {
  await refreshMasterData();
  const { workspaceId, role, accounts } = getState();
  const isReviewer = role === ROLE.SUPER_ADMIN;

  async function draw() {
    const [requests, transfers] = await Promise.all([
      listCorrections(workspaceId),
      listTransfers(workspaceId, 20),
    ]);

    const pending = requests.filter((r) => r.status === CORRECTION_STATUS.PENDING);
    const settled = requests.filter((r) => r.status !== CORRECTION_STATUS.PENDING);

    renderPage(
      pageHeader({
        title: 'Corrections',
        subtitle: isReviewer
          ? 'Review requests and reverse transfers.'
          : 'Your correction requests and their outcome.',
        actions: [el('button', { class: 'btn', type: 'button', onClick: () => goTo('/ledger') }, 'Ledger')],
      }),

      el(
        'section',
        { class: 'stack' },
        el('h2', {}, `Awaiting approval (${pending.length})`),
        pending.length === 0
          ? el(
              'div',
              { class: 'empty-state' },
              el('p', { class: 'u-weight-medium' }, 'Nothing waiting'),
              el('p', { class: 'u-text-sm' }, 'Requests appear here until a Super Admin decides.'),
            )
          : el('div', { class: 'stack' }, ...pending.map((request) => requestCard(request, draw, isReviewer, workspaceId))),
      ),

      isReviewer && transfersSection(transfers, accounts, workspaceId, draw),

      settled.length > 0 &&
        el(
          'section',
          { class: 'stack' },
          el('h2', {}, 'Decided'),
          el(
            'div',
            { class: 'stack stack--tight' },
            ...settled.map((request) =>
              el(
                'article',
                { class: 'txn-card' },
                el(
                  'div',
                  { class: 'row row--between' },
                  el('span', { class: 'u-weight-medium' }, request.targetVoucherNumber || 'Entry'),
                  el(
                    'span',
                    { class: `badge badge--${request.status === 'approved' ? 'confirmed' : 'draft'}` },
                    request.status === 'approved' ? 'Approved' : request.status === 'rejected' ? 'Rejected' : 'Cancelled',
                  ),
                ),
                el('p', { class: 'u-text-xs u-text-muted' }, request.reason),
                el(
                  'p',
                  { class: 'u-text-xs u-text-muted' },
                  `${request.reviewedByName ?? ''} · ${formatTimestamp(request.reviewedAt)}`,
                ),
              ),
            ),
          ),
        ),
    );
  }

  await draw();
}

/** @param {any} request @param {() => void} refresh @param {boolean} isReviewer @param {string} workspaceId */
function requestCard(request, refresh, isReviewer, workspaceId) {
  const before = request.originalSummary ?? {};
  const after = request.proposedSummary ?? {};

  /** Show only what actually differs, so a reviewer reads three lines rather than ten. */
  const changes = Object.keys(after).filter(
    (key) => JSON.stringify(after[key]) !== JSON.stringify(before[key]),
  );

  const approveButton = el('button', { class: 'btn btn--primary', type: 'button' }, 'Approve');
  approveButton.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Approve this correction?',
      message:
        'A reversal will be written that cancels the original entry, and the corrected figures will appear as a draft for confirming. The original stays on the record permanently.',
      confirmLabel: 'Approve correction',
    });
    if (!ok) return;

    const restore = setBusy(approveButton, 'Approving…');
    try {
      const result = await approveCorrection({ workspaceId, requestId: request.requestId });
      toast(`Reversal ${result.reversalVoucher} written. The corrected entry is waiting in Drafts.`, { duration: 7000 });
      refresh();
    } catch (error) {
      toast(error?.message ?? 'Could not approve.', { tone: 'danger', duration: 7000 });
      restore();
    }
  });

  const rejectButton = el('button', { class: 'btn', type: 'button' }, 'Reject');
  rejectButton.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Reject this request?',
      message: 'The entry stays exactly as it is. The requester will see the rejection.',
      confirmLabel: 'Reject',
      destructive: true,
    });
    if (!ok) return;
    await rejectCorrection({ workspaceId, requestId: request.requestId, note: '' });
    toast('Request rejected');
    refresh();
  });

  return el(
    'article',
    { class: 'card stack stack--tight' },
    el(
      'div',
      { class: 'row row--between' },
      el('span', { class: 'u-weight-medium tnum' }, request.targetVoucherNumber || 'Entry'),
      el('span', { class: 'badge badge--draft' }, 'Pending'),
    ),
    el('p', { class: 'u-text-sm' }, `Reason: ${request.reason}`),
    el(
      'p',
      { class: 'u-text-xs u-text-muted' },
      `Requested by ${request.requestedByName ?? ''} · ${formatTimestamp(request.requestedAt)}`,
    ),
    changes.length === 0
      ? el('p', { class: 'u-text-xs u-text-warning' }, 'Nothing was actually changed in this proposal.')
      : el(
          'div',
          { class: 'stack stack--tight' },
          el('p', { class: 'u-text-xs u-weight-medium' }, 'Proposed changes'),
          ...changes.map((key) =>
            el(
              'div',
              { class: 'row row--between u-text-xs' },
              el('span', { class: 'u-text-muted' }, key),
              el(
                'span',
                {},
                el('span', { class: 'u-text-muted' }, formatValue(key, before[key])),
                ' \u2192 ',
                el('span', { class: 'u-weight-medium' }, formatValue(key, after[key])),
              ),
            ),
          ),
        ),
    isReviewer && el('div', { class: 'row u-gap-2' }, approveButton, rejectButton),
  );
}

function formatValue(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'amountPaise') return formatPaise(value);
  return String(value);
}

/** @param {any[]} transfers @param {any[]} accounts @param {string} workspaceId @param {() => void} refresh */
function transfersSection(transfers, accounts, workspaceId, refresh) {
  const reversible = transfers.filter((t) => !t.reversedByTransferId && t.status === 'confirmed');

  return el(
    'section',
    { class: 'stack' },
    el('h2', {}, 'Reverse a transfer'),
    el(
      'p',
      { class: 'u-text-secondary u-text-sm' },
      'A transfer cannot be edited. Reversing it records the opposite movement, so both appear on the account statement — which is what actually happened.',
    ),
    reversible.length === 0
      ? el('div', { class: 'empty-state' }, el('p', { class: 'u-text-sm' }, 'No transfers to reverse.'))
      : el(
          'div',
          { class: 'stack stack--tight' },
          ...reversible.map((transfer) => {
            const button = el('button', { class: 'btn btn--danger', type: 'button' }, 'Reverse');
            button.addEventListener('click', async () => {
              const reason = window.prompt(
                `Why is ${transfer.voucherNumber} being reversed? (at least 10 characters — this is recorded permanently)`,
                '',
              );
              if (reason === null) return;

              const restore = setBusy(button, 'Reversing…');
              try {
                const result = await reverseTransfer({
                  workspaceId,
                  transferId: transfer.transferId,
                  reason,
                  accounts,
                });
                toast(`Reversed as ${result.voucherNumber}`);
                refresh();
              } catch (error) {
                toast(error?.message ?? 'Could not reverse.', { tone: 'danger', duration: 7000 });
                restore();
              }
            });

            return el(
              'article',
              { class: 'txn-card' },
              el(
                'div',
                { class: 'row row--between' },
                el('span', { class: 'u-weight-medium u-truncate' }, transfer.description),
                el('span', { class: 'money tnum' }, formatPaise(transfer.amountPaise, { symbol: false })),
              ),
              el(
                'div',
                { class: 'row row--between u-text-xs u-text-muted' },
                el('span', {}, `${transfer.fromAccountNameSnapshot} \u2192 ${transfer.toAccountNameSnapshot} · ${transfer.voucherNumber}`),
                button,
              ),
            );
          }),
        ),
  );
}
