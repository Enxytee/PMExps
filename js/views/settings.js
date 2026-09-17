/**
 * PMExps — Settings: accounts and categories
 *
 * Super Admin only. A Viewer or Accountant reaching this route by typing the
 * URL gets a clear refusal rather than a broken form — and even if the form
 * rendered, every write would be rejected by security rules.
 *
 * Neither list has a delete button. Records are deactivated, which keeps every
 * historical ledger row resolvable. A category that has been used cannot even
 * change its type, because flipping income to expense would silently invert
 * the sign of every entry behind it.
 *
 * @module views/settings
 */

import { el, replaceChildren } from '../utils/dom.js';
import { renderPage, pageHeader, goTo } from '../components/shell.js';
import {
  field,
  textInput,
  select,
  moneyInput,
  dateInput,
  toast,
  setBusy,
  setFormError,
  confirmDialog,
} from '../components/ui.js';
import { getState, refreshMasterData } from '../state.js';
import {
  createAccount,
  updateAccount,
  setAccountActive,
  createCategory,
  updateCategory,
  setCategoryActive,
  MasterDataError,
} from '../repositories/master-data.js';
import { formatPaise } from '../utils/money.js';
import { todayLedgerDate } from '../utils/dates.js';
import { ROLE, ACCOUNT_TYPE, ENTRY_TYPE } from '../config/constants.js';

const ACCOUNT_TYPE_LABEL = {
  [ACCOUNT_TYPE.CASH]: 'Cash',
  [ACCOUNT_TYPE.BANK]: 'Bank',
  [ACCOUNT_TYPE.UPI_CARD]: 'UPI / Card',
  [ACCOUNT_TYPE.PARTY]: 'Person / Party',
};

/** @param {import('../router.js').RouteContext} context */
export async function renderSettings(context) {
  await refreshMasterData();
  const { role } = getState();

  if (role !== ROLE.SUPER_ADMIN) {
    renderPage(
      pageHeader({ title: 'Settings' }),
      el(
        'div',
        { class: 'alert alert--info' },
        'Only a Super Admin can manage accounts, categories and members. Ask yours if something needs changing.',
      ),
      el('button', { class: 'btn', type: 'button', onClick: () => goTo('/') }, 'Back to dashboard'),
    );
    return;
  }

  let tab = context.query.get('tab') === 'categories' ? 'categories' : 'accounts';

  function draw() {
    renderPage(
      pageHeader({
        title: 'Settings',
        subtitle: 'Accounts and categories for this workspace.',
      }),

      el(
        'div',
        { class: 'tabs', role: 'tablist', 'aria-label': 'Settings sections' },
        tabButton('accounts', 'Accounts'),
        tabButton('categories', 'Categories'),
      ),

      tab === 'accounts' ? accountsPanel() : categoriesPanel(),
    );
  }

  function tabButton(id, label) {
    const isSelected = tab === id;
    return el(
      'button',
      {
        class: `tab${isSelected ? ' is-selected' : ''}`,
        type: 'button',
        role: 'tab',
        'aria-selected': String(isSelected),
        onClick: () => {
          tab = id;
          draw();
        },
      },
      label,
    );
  }

  /* ---------------------------------------------------------------------
     Accounts
     --------------------------------------------------------------------- */

  function accountsPanel() {
    const { accounts, workspaceId } = getState();

    return el(
      'div',
      { class: 'stack stack--loose', role: 'tabpanel' },

      el(
        'div',
        { class: 'stack' },
        el('h2', {}, 'Accounts'),
        ...accounts.map((account) =>
          el(
            'article',
            { class: `card${account.isActive ? '' : ' is-inactive'}` },
            el(
              'div',
              { class: 'row row--between u-gap-4' },
              el(
                'div',
                { class: 'u-flex-1' },
                el(
                  'p',
                  { class: 'u-weight-medium' },
                  account.name,
                  !account.isActive && el('span', { class: 'badge', style: { 'margin-left': 'var(--space-2)' } }, 'Inactive'),
                ),
                el(
                  'p',
                  { class: 'card__meta' },
                  `${ACCOUNT_TYPE_LABEL[account.type] ?? account.type} · opening ${formatPaise(account.openingBalancePaise ?? 0)} on ${account.openingBalanceDate}`,
                ),
                account.accountNumberMasked && el('p', { class: 'card__meta' }, account.accountNumberMasked),
              ),
              el(
                'button',
                {
                  class: 'btn btn--ghost',
                  type: 'button',
                  onClick: async () => {
                    const turningOff = account.isActive;
                    const ok = await confirmDialog({
                      title: turningOff ? `Deactivate ${account.name}?` : `Reactivate ${account.name}?`,
                      message: turningOff
                        ? 'It will no longer appear when adding an entry. Existing entries keep it, and nothing is deleted.'
                        : 'It will appear again when adding an entry.',
                      confirmLabel: turningOff ? 'Deactivate' : 'Reactivate',
                      destructive: turningOff,
                    });
                    if (!ok) return;
                    await setAccountActive(workspaceId, account.accountId, !account.isActive);
                    await refreshMasterData({ force: true });
                    toast(turningOff ? 'Account deactivated' : 'Account reactivated');
                    draw();
                  },
                },
                account.isActive ? 'Deactivate' : 'Reactivate',
              ),
            ),
          ),
        ),
      ),

      accountForm(),
    );
  }

  function accountForm() {
    const form = {
      name: '',
      type: ACCOUNT_TYPE.BANK,
      bankName: '',
      accountNumber: '',
      openingBalancePaise: 0,
      openingBalanceDate: todayLedgerDate(),
    };
    /** @type {Record<string, string>} */
    let errors = {};
    const errorBox = el('div', {});

    const submit = /** @type {HTMLButtonElement} */ (
      el('button', { class: 'btn btn--primary', type: 'submit' }, 'Add account')
    );

    async function onSubmit(event) {
      event.preventDefault();
      setFormError(errorBox, null);
      const restore = setBusy(submit, 'Adding…');
      try {
        await createAccount(getState().workspaceId, form, getState().accounts);
        await refreshMasterData({ force: true });
        toast('Account added');
        draw();
      } catch (error) {
        errors = error instanceof MasterDataError ? error.errors : {};
        setFormError(errorBox, error?.message ?? 'Could not add the account.');
        restore();
        // Re-render the whole panel so inline errors appear on the fields.
        draw();
      }
    }

    return el(
      'form',
      { class: 'stack form-page', novalidate: true, onSubmit },
      el('h2', {}, 'Add an account'),
      field({
        label: 'Name',
        required: true,
        control: textInput({
          maxlength: 60,
          placeholder: 'HDFC Current',
          onInput: (value) => { form.name = value; },
        }),
        error: errors.name,
      }),
      field({
        label: 'Type',
        required: true,
        control: select({
          value: form.type,
          options: Object.entries(ACCOUNT_TYPE_LABEL).map(([value, label]) => ({ value, label })),
          onChange: (value) => { form.type = value; },
        }),
        error: errors.type,
      }),
      field({
        label: 'Bank or party name',
        control: textInput({ maxlength: 80, onInput: (value) => { form.bankName = value; } }),
        hint: 'Optional.',
      }),
      field({
        label: 'Account number',
        control: textInput({
          maxlength: 30,
          inputmode: 'numeric',
          onInput: (value) => { form.accountNumber = value; },
        }),
        hint: 'Optional. Only the last four digits are stored — never the full number.',
      }),
      field({
        label: 'Opening balance',
        control: moneyInput({
          paise: 0,
          onValue: (value) => { form.openingBalancePaise = value === 'invalid' || value === null ? 0 : value; },
        }),
        hint: 'The balance on the date below. Can be negative for a party who owes you.',
        error: errors.openingBalancePaise,
      }),
      field({
        label: 'Opening balance date',
        required: true,
        control: dateInput({
          value: form.openingBalanceDate,
          onChange: (value) => { form.openingBalanceDate = value; },
        }),
        error: errors.openingBalanceDate,
      }),
      errorBox,
      submit,
    );
  }

  /* ---------------------------------------------------------------------
     Categories
     --------------------------------------------------------------------- */

  function categoriesPanel() {
    const { categories, workspaceId } = getState();

    const group = (type, title) =>
      el(
        'div',
        { class: 'stack' },
        el('h3', {}, title),
        ...categories
          .filter((c) => c.type === type)
          .map((category) =>
            el(
              'article',
              { class: 'card' },
              el(
                'div',
                { class: 'row row--between u-gap-4' },
                el(
                  'div',
                  { class: 'u-flex-1' },
                  el(
                    'p',
                    { class: 'u-weight-medium' },
                    category.name,
                    !category.isActive && el('span', { class: 'badge', style: { 'margin-left': 'var(--space-2)' } }, 'Inactive'),
                  ),
                  el(
                    'p',
                    { class: 'card__meta' },
                    (category.entryCount ?? 0) > 0
                      ? `${category.entryCount} entries · type cannot be changed`
                      : 'Not used yet',
                  ),
                ),
                el(
                  'button',
                  {
                    class: 'btn btn--ghost',
                    type: 'button',
                    onClick: async () => {
                      const turningOff = category.isActive;
                      const ok = await confirmDialog({
                        title: turningOff ? `Deactivate ${category.name}?` : `Reactivate ${category.name}?`,
                        message: turningOff
                          ? 'It will no longer appear when adding an entry. Existing entries keep it.'
                          : 'It will appear again when adding an entry.',
                        confirmLabel: turningOff ? 'Deactivate' : 'Reactivate',
                        destructive: turningOff,
                      });
                      if (!ok) return;
                      await setCategoryActive(workspaceId, category.categoryId, !category.isActive);
                      await refreshMasterData({ force: true });
                      toast(turningOff ? 'Category deactivated' : 'Category reactivated');
                      draw();
                    },
                  },
                  category.isActive ? 'Deactivate' : 'Reactivate',
                ),
              ),
            ),
          ),
      );

    return el(
      'div',
      { class: 'stack stack--loose', role: 'tabpanel' },
      el('div', { class: 'grid grid--halves' }, group(ENTRY_TYPE.INCOME, 'Income'), group(ENTRY_TYPE.EXPENSE, 'Expense')),
      categoryForm(),
    );
  }

  function categoryForm() {
    const form = { name: '', type: ENTRY_TYPE.EXPENSE };
    /** @type {Record<string, string>} */
    let errors = {};
    const errorBox = el('div', {});

    const submit = /** @type {HTMLButtonElement} */ (
      el('button', { class: 'btn btn--primary', type: 'submit' }, 'Add category')
    );

    async function onSubmit(event) {
      event.preventDefault();
      setFormError(errorBox, null);
      const restore = setBusy(submit, 'Adding…');
      try {
        await createCategory(getState().workspaceId, form, getState().categories);
        await refreshMasterData({ force: true });
        toast('Category added');
        draw();
      } catch (error) {
        errors = error instanceof MasterDataError ? error.errors : {};
        setFormError(errorBox, error?.message ?? 'Could not add the category.');
        restore();
        draw();
      }
    }

    return el(
      'form',
      { class: 'stack form-page', novalidate: true, onSubmit },
      el('h2', {}, 'Add a category'),
      field({
        label: 'Name',
        required: true,
        control: textInput({
          maxlength: 60,
          placeholder: 'Freight & transport',
          onInput: (value) => { form.name = value; },
        }),
        error: errors.name,
      }),
      field({
        label: 'Type',
        required: true,
        control: select({
          value: form.type,
          options: [
            { value: ENTRY_TYPE.INCOME, label: 'Income' },
            { value: ENTRY_TYPE.EXPENSE, label: 'Expense' },
          ],
          onChange: (value) => { form.type = value; },
        }),
        hint: 'This cannot be changed once the category has entries.',
        error: errors.type,
      }),
      errorBox,
      submit,
    );
  }

  draw();
}
