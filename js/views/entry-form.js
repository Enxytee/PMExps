/**
 * PMExps — Entry form
 *
 * Creates and edits draft income and expense entries.
 *
 * Two decisions worth knowing about:
 *
 * 1. The idempotency key is generated when the form opens, not when Save is
 *    pressed, and it stays the same across retries of that one entry. If the
 *    network drops after Firestore accepted the write but before the response
 *    arrived, pressing Save again re-uses the key instead of creating a second
 *    entry for the same expense.
 *
 * 2. Nothing here can confirm an entry. There is no code path from this form
 *    to a voucher number or a balance — that arrives in Phase 4, behind a
 *    transaction.
 *
 * @module views/entry-form
 */

import { el, replaceChildren, qs } from '../utils/dom.js';
import { renderPage, pageHeader, goTo } from '../components/shell.js';
import {
  field,
  textInput,
  textArea,
  select,
  moneyInput,
  dateInput,
  segmented,
  toast,
  setBusy,
  setFormError,
  confirmDialog,
} from '../components/ui.js';
import { getState, selectableAccounts, selectableCategories, refreshMasterData } from '../state.js';
import {
  createDraft,
  updateDraft,
  getEntry,
  voidDraft,
  newRequestId,
  EntryError,
} from '../repositories/entries.js';
import { todayLedgerDate, addDays } from '../utils/dates.js';
import { ENTRY_TYPE, PAYMENT_MODE, ENTRY_STATUS } from '../config/constants.js';
import { formatPaise } from '../utils/money.js';

const PAYMENT_MODE_LABELS = {
  [PAYMENT_MODE.CASH]: 'Cash',
  [PAYMENT_MODE.BANK_TRANSFER]: 'Bank transfer',
  [PAYMENT_MODE.UPI]: 'UPI',
  [PAYMENT_MODE.DEBIT_CARD]: 'Debit card',
  [PAYMENT_MODE.CREDIT_CARD]: 'Credit card',
  [PAYMENT_MODE.CHEQUE]: 'Cheque',
  [PAYMENT_MODE.OTHER]: 'Other',
};

/**
 * @param {import('../router.js').RouteContext} context
 */
export async function renderEntryForm(context) {
  await refreshMasterData();

  const { workspaceId } = getState();
  const entryId = context.params.entryId ?? null;
  const isEditing = Boolean(entryId);

  /** @type {Record<string, any>} */
  let form = {
    type: context.query.get('type') === 'expense' ? ENTRY_TYPE.EXPENSE : ENTRY_TYPE.INCOME,
    ledgerDate: todayLedgerDate(),
    amountPaise: null,
    rawAmount: '',
    accountId: '',
    categoryId: '',
    description: '',
    partyName: '',
    paymentMode: PAYMENT_MODE.CASH,
    referenceNumber: '',
    remarks: '',
    clientRequestId: newRequestId(),
  };

  if (isEditing) {
    const existing = await getEntry(workspaceId, entryId);
    if (!existing) {
      renderPage(
        pageHeader({ title: 'Entry not found' }),
        el('div', { class: 'alert alert--warning' }, 'That entry no longer exists.'),
        el('button', { class: 'btn', type: 'button', onClick: () => goTo('/drafts') }, 'Back to drafts'),
      );
      return;
    }

    if (existing.status !== ENTRY_STATUS.DRAFT) {
      renderPage(
        pageHeader({ title: 'Entry is locked' }),
        el(
          'div',
          { class: 'alert alert--info' },
          'This entry is confirmed, so it cannot be edited. A correction request preserves the original and records the change — that arrives in Phase 5.',
        ),
        el('button', { class: 'btn', type: 'button', onClick: () => goTo('/ledger') }, 'Back to ledger'),
      );
      return;
    }

    form = {
      ...form,
      ...existing,
      rawAmount: String(existing.amountPaise / 100),
      partyName: existing.partyName ?? '',
      referenceNumber: existing.referenceNumber ?? '',
      remarks: existing.remarks ?? '',
    };
  }

  /** @type {Record<string, string>} */
  let errors = {};

  function draw() {
    const accounts = selectableAccounts();
    const categories = selectableCategories(form.type);
    const errorBox = el('div', {});

    const amountControl = moneyInput({
      paise: form.amountPaise,
      onValue: (value) => {
        form.amountPaise = value === 'invalid' ? null : value;
        form.invalidAmount = value === 'invalid';
      },
    });

    const saveButton = /** @type {HTMLButtonElement} */ (
      el('button', { class: 'btn btn--primary', type: 'submit' }, isEditing ? 'Save draft' : 'Save as draft')
    );

    async function onSubmit(event) {
      event.preventDefault();
      setFormError(errorBox, null);
      const restore = setBusy(saveButton, 'Saving…');

      try {
        if (form.invalidAmount) {
          throw new EntryError('validation-failed', 'Fix the highlighted fields.', {
            amountPaise: 'That amount could not be read. Use digits only, e.g. 1250.50',
          });
        }

        const payload = { ...form };

        if (isEditing) {
          await updateDraft({
            workspaceId,
            entryId,
            entry: payload,
            accounts: getState().accounts,
            categories: getState().categories,
          });
          toast('Draft saved');
        } else {
          await createDraft({
            workspaceId,
            entry: payload,
            accounts: getState().accounts,
            categories: getState().categories,
          });
          toast('Draft saved');
        }

        goTo('/drafts');
      } catch (error) {
        errors = error instanceof EntryError ? error.errors : {};
        setFormError(
          errorBox,
          Object.keys(errors).length
            ? 'Fix the highlighted fields.'
            : (error?.message ?? 'Could not save the draft.'),
        );
        restore();
        draw();
        // Put focus on the first field with a problem so a keyboard user is
        // taken straight to it instead of hunting.
        const firstError = Object.keys(errors)[0];
        if (firstError) qs(`[data-field="${firstError}"] .input, [data-field="${firstError}"] .select`)?.focus();
      }
    }

    const typeSwitch = segmented({
      label: 'Entry type',
      value: form.type,
      options: [
        { value: ENTRY_TYPE.INCOME, label: 'Income' },
        { value: ENTRY_TYPE.EXPENSE, label: 'Expense' },
      ],
      onChange: (value) => {
        form.type = value;
        // The chosen category belongs to the old type, so it is cleared
        // rather than left to fail validation with a confusing message.
        form.categoryId = '';
        draw();
      },
    });

    const wrap = (name, node) => el('div', { dataset: { field: name } }, node);

    renderPage(
      pageHeader({
        title: isEditing ? 'Edit draft' : 'Add entry',
        subtitle: isEditing ? 'Only drafts can be edited.' : 'Saved as a draft. Confirming comes in Phase 4.',
        actions: [
          el('button', { class: 'btn', type: 'button', onClick: () => goTo('/drafts') }, 'Cancel'),
        ],
      }),

      el(
        'form',
        { class: 'stack form-page', novalidate: true, onSubmit },

        typeSwitch,
        errors.type && el('p', { class: 'field__error' }, errors.type),

        wrap('amountPaise', field({
          label: 'Amount',
          required: true,
          control: amountControl,
          hint: 'Rupees and paise, e.g. 1250.50',
          error: errors.amountPaise,
        })),

        wrap('ledgerDate', field({
          label: 'Date',
          required: true,
          control: dateInput({
            value: form.ledgerDate,
            max: addDays(todayLedgerDate(), 365),
            onChange: (value) => { form.ledgerDate = value; },
          }),
          error: errors.ledgerDate,
        })),

        wrap('categoryId', field({
          label: 'Category',
          required: true,
          control: select({
            value: form.categoryId,
            placeholder: 'Choose a category',
            options: categories.map((c) => ({ value: c.categoryId, label: c.name })),
            onChange: (value) => { form.categoryId = value; },
          }),
          hint: categories.length ? undefined : 'No active categories for this type. Add one in Settings.',
          error: errors.categoryId,
        })),

        wrap('accountId', field({
          label: 'Account',
          required: true,
          control: select({
            value: form.accountId,
            placeholder: 'Choose an account',
            options: accounts.map((a) => ({ value: a.accountId, label: a.name })),
            onChange: (value) => { form.accountId = value; },
          }),
          error: errors.accountId,
        })),

        wrap('paymentMode', field({
          label: 'Payment mode',
          required: true,
          control: select({
            value: form.paymentMode,
            options: Object.entries(PAYMENT_MODE_LABELS).map(([value, label]) => ({ value, label })),
            onChange: (value) => { form.paymentMode = value; },
          }),
          error: errors.paymentMode,
        })),

        wrap('description', field({
          label: 'Description',
          required: true,
          control: textInput({
            value: form.description,
            maxlength: 200,
            placeholder: form.type === ENTRY_TYPE.INCOME ? 'Payment from Sharma & Co' : 'Office electricity bill',
            onInput: (value) => { form.description = value; },
          }),
          error: errors.description,
        })),

        wrap('partyName', field({
          label: 'Person or party',
          control: textInput({
            value: form.partyName,
            maxlength: 100,
            onInput: (value) => { form.partyName = value; },
          }),
          hint: 'Optional.',
          error: errors.partyName,
        })),

        wrap('referenceNumber', field({
          label: 'Reference number',
          control: textInput({
            value: form.referenceNumber,
            maxlength: 50,
            placeholder: 'Cheque, invoice or UTR number',
            onInput: (value) => { form.referenceNumber = value; },
          }),
          hint: 'Optional.',
          error: errors.referenceNumber,
        })),

        wrap('remarks', field({
          label: 'Remarks',
          control: textArea({
            value: form.remarks,
            maxlength: 500,
            onInput: (value) => { form.remarks = value; },
          }),
          hint: 'Optional.',
          error: errors.remarks,
        })),

        errorBox,

        el(
          'div',
          { class: 'row u-gap-2' },
          saveButton,
          isEditing &&
            el(
              'button',
              {
                class: 'btn btn--danger',
                type: 'button',
                onClick: async () => {
                  const ok = await confirmDialog({
                    title: 'Remove this draft?',
                    message:
                      'It will be moved out of your drafts. Nothing is permanently deleted, and it can be restored.',
                    confirmLabel: 'Remove draft',
                    destructive: true,
                  });
                  if (!ok) return;
                  await voidDraft(workspaceId, entryId);
                  toast('Draft removed');
                  goTo('/drafts');
                },
              },
              'Remove draft',
            ),
        ),
      ),
    );
  }

  draw();
}
