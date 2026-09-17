/**
 * PMExps — Transfer form and list
 * @module views/transfer
 */

import { el } from '../utils/dom.js';
import { renderPage, pageHeader, goTo } from '../components/shell.js';
import { field, select, moneyInput, dateInput, textInput, textArea, toast, setBusy, setFormError } from '../components/ui.js';
import { getState, selectableAccounts, refreshMasterData } from '../state.js';
import { createTransfer, listTransfers, validateTransfer } from '../services/transfers.js';
import { getLockDate } from '../services/lock.js';
import { formatPaise } from '../utils/money.js';
import { todayLedgerDate, formatLedgerDate } from '../utils/dates.js';

export async function renderTransfer() {
  await refreshMasterData();
  const { workspaceId } = getState();
  const lockDate = await getLockDate(workspaceId);

  const form = {
    fromAccountId: '',
    toAccountId: '',
    amountPaise: null,
    ledgerDate: todayLedgerDate(),
    description: '',
    referenceNumber: '',
    remarks: '',
  };

  /** @type {Record<string, string>} */
  let errors = {};
  let transfers = await listTransfers(workspaceId, 20);

  function draw() {
    const accounts = selectableAccounts();
    const errorBox = el('div', {});
    const submit = el('button', { class: 'btn btn--primary', type: 'submit' }, 'Record transfer');

    async function onSubmit(event) {
      event.preventDefault();
      setFormError(errorBox, null);

      const result = validateTransfer(form, getState().accounts, lockDate);
      if (!result.valid) {
        errors = result.errors;
        setFormError(errorBox, 'Fix the highlighted fields.');
        draw();
        return;
      }

      const restore = setBusy(submit, 'Recording…');
      try {
        const { voucherNumber } = await createTransfer({
          workspaceId,
          ...form,
          accounts: getState().accounts,
        });
        toast(`Transfer recorded as ${voucherNumber}`);
        transfers = await listTransfers(workspaceId, 20);
        form.amountPaise = null;
        form.description = '';
        errors = {};
        draw();
      } catch (error) {
        setFormError(errorBox, error?.message ?? 'Could not record the transfer.');
        restore();
      }
    }

    const accountOptions = accounts.map((a) => ({ value: a.accountId, label: a.name }));

    renderPage(
      pageHeader({
        title: 'Account transfer',
        subtitle: 'Move money between your own accounts. Not income, not an expense.',
        actions: [el('button', { class: 'btn', type: 'button', onClick: () => goTo('/ledger') }, 'Back to ledger')],
      }),

      el(
        'div',
        { class: 'alert alert--info' },
        'A transfer writes two matching lines at once — one leaving, one arriving. Your overall balance does not change, only where the money sits. Both lines save together or neither does.',
      ),

      el(
        'form',
        { class: 'stack form-page', novalidate: true, onSubmit },

        field({
          label: 'From account',
          required: true,
          control: select({
            value: form.fromAccountId,
            placeholder: 'Money leaves…',
            options: accountOptions,
            onChange: (value) => { form.fromAccountId = value; },
          }),
          error: errors.fromAccountId,
        }),

        field({
          label: 'To account',
          required: true,
          control: select({
            value: form.toAccountId,
            placeholder: 'Money arrives…',
            options: accountOptions,
            onChange: (value) => { form.toAccountId = value; },
          }),
          error: errors.toAccountId,
        }),

        field({
          label: 'Amount',
          required: true,
          control: moneyInput({
            paise: form.amountPaise,
            onValue: (value) => { form.amountPaise = value === 'invalid' ? null : value; },
          }),
          error: errors.amountPaise,
        }),

        field({
          label: 'Date',
          required: true,
          control: dateInput({
            value: form.ledgerDate,
            onChange: (value) => { form.ledgerDate = value; },
          }),
          error: errors.ledgerDate,
        }),

        field({
          label: 'Description',
          required: true,
          control: textInput({
            value: form.description,
            maxlength: 200,
            placeholder: 'Cash deposited into current account',
            onInput: (value) => { form.description = value; },
          }),
          error: errors.description,
        }),

        field({
          label: 'Reference number',
          control: textInput({
            value: form.referenceNumber,
            maxlength: 50,
            onInput: (value) => { form.referenceNumber = value; },
          }),
          hint: 'Optional. Cheque or UTR number.',
        }),

        field({
          label: 'Remarks',
          control: textArea({ value: form.remarks, maxlength: 500, onInput: (value) => { form.remarks = value; } }),
          hint: 'Optional.',
        }),

        errorBox,
        submit,
      ),

      el(
        'section',
        { class: 'stack' },
        el('h2', {}, 'Recent transfers'),
        transfers.length === 0
          ? el(
              'div',
              { class: 'empty-state' },
              el('p', { class: 'u-weight-medium' }, 'No transfers yet'),
              el('p', { class: 'u-text-sm' }, 'Moving money between your accounts will show here.'),
            )
          : el(
              'div',
              { class: 'stack stack--tight' },
              ...transfers.map((transfer) =>
                el(
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
                    el('span', {}, `${transfer.fromAccountNameSnapshot} \u2192 ${transfer.toAccountNameSnapshot}`),
                    el('span', { class: 'tnum' }, transfer.voucherNumber ?? '—'),
                  ),
                  el('p', { class: 'u-text-xs u-text-muted' }, formatLedgerDate(transfer.ledgerDate)),
                ),
              ),
            ),
      ),
    );
  }

  draw();
}
