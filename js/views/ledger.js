/**
 * PMExps — Ledger, drafts and dashboard
 *
 * The daily ledger is a table on desktop and a list of cards on mobile. It is
 * not a horizontally scrolled table: on a phone, scrolling a financial table
 * sideways hides the amount column, which is the one column that must always
 * be visible.
 *
 * Status is shown as a labelled badge, never as a colour alone.
 *
 * @module views/ledger
 */

import { el, replaceChildren } from '../utils/dom.js';
import { renderPage, pageHeader, goTo } from '../components/shell.js';
import { toast, confirmDialog, dateInput } from '../components/ui.js';
import { getState, refreshMasterData } from '../state.js';
import { listByDate, listDrafts, listRecent, voidDraft } from '../repositories/entries.js';
import { formatPaise, sumBy } from '../utils/money.js';
import {
  todayLedgerDate,
  addDays,
  formatLedgerDate,
  formatRelativeLedgerDate,
  financialYear,
} from '../utils/dates.js';
import { ENTRY_TYPE, ENTRY_STATUS, ROLE } from '../config/constants.js';

const STATUS_LABEL = {
  [ENTRY_STATUS.DRAFT]: 'Draft',
  [ENTRY_STATUS.CONFIRMED]: 'Confirmed',
  [ENTRY_STATUS.LOCKED]: 'Locked',
  [ENTRY_STATUS.CORRECTED]: 'Corrected',
  [ENTRY_STATUS.REVERSED]: 'Reversed',
};

/** @param {string} status */
function statusBadge(status) {
  const modifier =
    status === ENTRY_STATUS.DRAFT
      ? 'draft'
      : status === ENTRY_STATUS.LOCKED
        ? 'locked'
        : 'confirmed';
  return el('span', { class: `badge badge--${modifier}` }, STATUS_LABEL[status] ?? status);
}

/**
 * Income and expense are distinguished by an explicit word and a sign, not by
 * colour. Colour is added on top for people who can use it.
 * @param {Record<string, any>} entry
 */
function amountCell(entry) {
  const isIncome = entry.type === ENTRY_TYPE.INCOME;
  return el(
    'span',
    { class: `money ${isIncome ? 'money--in' : 'money--out'}` },
    el('span', { class: 'sr-only' }, isIncome ? 'Income ' : 'Expense '),
    `${isIncome ? '+' : '\u2212'}${formatPaise(entry.amountPaise, { symbol: false })}`,
  );
}

/** @param {any[]} entries */
function totals(entries) {
  const counted = entries.filter((e) => e.status !== ENTRY_STATUS.VOID_DRAFT);
  const income = sumBy(
    counted.filter((e) => e.type === ENTRY_TYPE.INCOME),
    (e) => e.amountPaise,
  );
  const expense = sumBy(
    counted.filter((e) => e.type === ENTRY_TYPE.EXPENSE),
    (e) => e.amountPaise,
  );
  return { income, expense, net: income - expense };
}

/* -------------------------------------------------------------------------
   Daily ledger
   ------------------------------------------------------------------------- */

/** @param {import('../router.js').RouteContext} context */
export async function renderLedger(context) {
  await refreshMasterData();
  const { workspaceId, role } = getState();
  let ledgerDate = context.query.get('date') ?? todayLedgerDate();

  async function draw() {
    const entries = await listByDate(workspaceId, ledgerDate);
    const drafts = entries.filter((e) => e.status === ENTRY_STATUS.DRAFT);
    const confirmed = entries.filter((e) => e.status !== ENTRY_STATUS.DRAFT);
    const sums = totals(confirmed);
    const draftSums = totals(drafts);

    const datePicker = dateInput({
      value: ledgerDate,
      onChange: (value) => {
        if (!value) return;
        ledgerDate = value;
        draw();
      },
    });
    // The id must exist before the label references it, or the label points
    // at nothing and the input has no accessible name.
    datePicker.id = 'ledger-date';

    renderPage(
      pageHeader({
        title: 'Daily ledger',
        subtitle: formatLedgerDate(ledgerDate, { style: 'long' }),
        actions: [
          el(
            'button',
            { class: 'btn', type: 'button', onClick: () => { ledgerDate = addDays(ledgerDate, -1); draw(); } },
            'Previous day',
          ),
          el(
            'button',
            { class: 'btn', type: 'button', onClick: () => { ledgerDate = todayLedgerDate(); draw(); } },
            'Today',
          ),
          el(
            'button',
            { class: 'btn', type: 'button', onClick: () => { ledgerDate = addDays(ledgerDate, 1); draw(); } },
            'Next day',
          ),
          role !== ROLE.VIEWER &&
            el(
              'button',
              { class: 'btn btn--primary', type: 'button', onClick: () => goTo('/entry/new') },
              'Add entry',
            ),
        ],
      }),

      el(
        'div',
        { class: 'field', style: { 'max-width': '220px' } },
        el('label', { class: 'field__label', for: 'ledger-date' }, 'Jump to date'),
        datePicker,
      ),

      el(
        'section',
        { class: 'grid grid--summary', 'aria-label': 'Day totals' },
        summaryCard('Confirmed income', formatPaise(sums.income), `${confirmed.filter((e) => e.type === 'income').length} entries`),
        summaryCard('Confirmed expenses', formatPaise(sums.expense), `${confirmed.filter((e) => e.type === 'expense').length} entries`),
        summaryCard('Net for the day', formatPaise(sums.net), 'Confirmed entries only'),
        summaryCard('In drafts', formatPaise(draftSums.income - draftSums.expense), `${drafts.length} not yet confirmed`),
      ),

      drafts.length > 0 &&
        el(
          'div',
          { class: 'alert alert--warning' },
          `${drafts.length} draft ${drafts.length === 1 ? 'entry is' : 'entries are'} not counted in the totals above. Confirming arrives in Phase 4.`,
        ),

      entries.length === 0
        ? el(
            'div',
            { class: 'empty-state' },
            el('p', { class: 'u-weight-medium' }, 'Nothing recorded on this date'),
            el('p', { class: 'u-text-sm' }, 'Use Add entry to record income or an expense.'),
          )
        : el('div', {}, entriesTable(entries), entriesCards(entries)),
    );
  }

  await draw();
}

/** @param {any[]} entries */
function entriesTable(entries) {
  return el(
    'table',
    { class: 'ledger-table', 'aria-label': 'Entries for this date' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { scope: 'col' }, 'Description'),
        el('th', { scope: 'col' }, 'Category'),
        el('th', { scope: 'col' }, 'Account'),
        el('th', { scope: 'col' }, 'Mode'),
        el('th', { scope: 'col' }, 'Status'),
        el('th', { scope: 'col', class: 'money' }, 'Amount'),
      ),
    ),
    el(
      'tbody',
      {},
      ...entries.map((entry) =>
        el(
          'tr',
          {},
          el(
            'td',
            {},
            el('span', { class: 'u-weight-medium' }, entry.description),
            entry.partyName && el('span', { class: 'u-text-muted u-text-xs' }, ` · ${entry.partyName}`),
          ),
          el('td', {}, entry.categoryNameSnapshot),
          el('td', {}, entry.accountNameSnapshot),
          el('td', {}, entry.paymentMode),
          el('td', {}, statusBadge(entry.status)),
          el('td', { class: 'money' }, amountCell(entry)),
        ),
      ),
    ),
  );
}

/** @param {any[]} entries */
function entriesCards(entries) {
  return el(
    'div',
    { class: 'ledger-cards stack' },
    ...entries.map((entry) =>
      el(
        'article',
        { class: 'txn-card' },
        el(
          'div',
          { class: 'row row--between' },
          el('span', { class: 'u-weight-medium u-truncate' }, entry.description),
          amountCell(entry),
        ),
        el(
          'div',
          { class: 'row row--between u-text-xs u-text-muted' },
          el('span', {}, `${entry.categoryNameSnapshot} · ${entry.accountNameSnapshot}`),
          statusBadge(entry.status),
        ),
      ),
    ),
  );
}

function summaryCard(label, value, detail) {
  return el(
    'article',
    { class: 'card' },
    el('p', { class: 'u-text-muted u-text-xs' }, label),
    el('p', { class: 'u-text-xl u-weight-semibold tnum' }, value),
    el('p', { class: 'u-text-muted u-text-xs' }, detail),
  );
}

/* -------------------------------------------------------------------------
   Drafts
   ------------------------------------------------------------------------- */

export async function renderDrafts() {
  await refreshMasterData();
  const { workspaceId, user } = getState();

  async function draw() {
    const drafts = await listDrafts(workspaceId, { mineOnly: false });

    renderPage(
      pageHeader({
        title: 'Drafts',
        subtitle: 'Not counted in any balance until confirmed.',
        actions: [
          el(
            'button',
            { class: 'btn btn--primary', type: 'button', onClick: () => goTo('/entry/new') },
            'Add entry',
          ),
        ],
      }),

      drafts.length === 0
        ? el(
            'div',
            { class: 'empty-state' },
            el('p', { class: 'u-weight-medium' }, 'No drafts'),
            el('p', { class: 'u-text-sm' }, 'Entries you save appear here until they are confirmed.'),
          )
        : el(
            'div',
            { class: 'stack' },
            ...drafts.map((entry) =>
              el(
                'article',
                { class: 'card' },
                el(
                  'div',
                  { class: 'row row--between u-gap-4' },
                  el(
                    'div',
                    { class: 'u-flex-1' },
                    el('p', { class: 'u-weight-medium' }, entry.description),
                    el(
                      'p',
                      { class: 'card__meta' },
                      `${formatRelativeLedgerDate(entry.ledgerDate)} · ${entry.categoryNameSnapshot} · ${entry.accountNameSnapshot}`,
                    ),
                    el('p', { class: 'card__meta' }, `Entered by ${entry.enteredByName || 'unknown'}`),
                  ),
                  el('div', { class: 'u-text-right' }, amountCell(entry), el('div', {}, statusBadge(entry.status))),
                ),
                el(
                  'div',
                  { class: 'row u-gap-2', style: { 'margin-top': 'var(--space-3)' } },
                  el(
                    'button',
                    { class: 'btn', type: 'button', onClick: () => goTo(`/entry/${entry.entryId}`) },
                    'Edit',
                  ),
                  el(
                    'button',
                    {
                      class: 'btn btn--ghost',
                      type: 'button',
                      onClick: async () => {
                        const ok = await confirmDialog({
                          title: 'Remove this draft?',
                          message: `"${entry.description}" will be moved out of drafts. Nothing is permanently deleted.`,
                          confirmLabel: 'Remove draft',
                          destructive: true,
                        });
                        if (!ok) return;
                        await voidDraft(workspaceId, entry.entryId);
                        toast('Draft removed');
                        draw();
                      },
                    },
                    'Remove',
                  ),
                ),
              ),
            ),
          ),
    );
  }

  await draw();
}

/* -------------------------------------------------------------------------
   Dashboard
   ------------------------------------------------------------------------- */

export async function renderDashboard() {
  await refreshMasterData();
  const { workspaceId, membership, accounts, role } = getState();

  const today = todayLedgerDate();
  const fy = financialYear(today);

  const [todayEntries, recent, drafts] = await Promise.all([
    listByDate(workspaceId, today),
    listRecent(workspaceId, 8),
    listDrafts(workspaceId, {}),
  ]);

  const confirmedToday = todayEntries.filter((e) => e.status !== ENTRY_STATUS.DRAFT);
  const sums = totals(confirmedToday);
  const firstName = String(membership?.displayNameSnapshot ?? '').split(' ')[0];

  renderPage(
    pageHeader({
      title: firstName ? `Welcome, ${firstName}` : 'Dashboard',
      subtitle: formatLedgerDate(today, { style: 'long' }),
      actions: [
        role !== ROLE.VIEWER &&
          el(
            'button',
            { class: 'btn btn--primary', type: 'button', onClick: () => goTo('/entry/new') },
            'Add entry',
          ),
      ],
    }),

    el(
      'section',
      { class: 'grid grid--summary', 'aria-label': 'Today' },
      summaryCard("Today's income", formatPaise(sums.income), 'Confirmed only'),
      summaryCard("Today's expenses", formatPaise(sums.expense), 'Confirmed only'),
      summaryCard('Net cash flow', formatPaise(sums.net), 'Income minus expenses'),
      summaryCard('Financial year', fy.label, `${fy.startDate} to ${fy.endDate}`),
    ),

    drafts.length > 0 &&
      el(
        'div',
        { class: 'alert alert--warning row row--between' },
        el('span', {}, `${drafts.length} draft ${drafts.length === 1 ? 'entry is' : 'entries are'} waiting. Drafts do not affect any balance.`),
        el('button', { class: 'btn', type: 'button', onClick: () => goTo('/drafts') }, 'Review drafts'),
      ),

    el(
      'section',
      { class: 'stack' },
      el('h2', {}, 'Accounts'),
      el(
        'div',
        { class: 'grid grid--summary' },
        ...accounts
          .filter((a) => a.isActive)
          .map((account) =>
            el(
              'article',
              { class: 'card' },
              el('p', { class: 'u-text-muted u-text-xs' }, account.name),
              el('p', { class: 'u-text-lg u-weight-semibold tnum' }, formatPaise(account.openingBalancePaise ?? 0)),
              el('p', { class: 'card__meta' }, 'Opening balance'),
            ),
          ),
      ),
    ),

    el(
      'section',
      { class: 'stack' },
      el(
        'div',
        { class: 'row row--between' },
        el('h2', {}, 'Recent entries'),
        el('button', { class: 'btn btn--ghost', type: 'button', onClick: () => goTo('/ledger') }, 'Open ledger'),
      ),
      recent.length === 0
        ? el(
            'div',
            { class: 'empty-state' },
            el('p', { class: 'u-weight-medium' }, 'No entries yet'),
            el('p', { class: 'u-text-sm' }, 'Your first income or expense will appear here.'),
          )
        : el(
            'div',
            { class: 'stack stack--tight' },
            ...recent.map((entry) =>
              el(
                'article',
                { class: 'txn-card' },
                el(
                  'div',
                  { class: 'row row--between' },
                  el('span', { class: 'u-weight-medium u-truncate' }, entry.description),
                  amountCell(entry),
                ),
                el(
                  'div',
                  { class: 'row row--between u-text-xs u-text-muted' },
                  el('span', {}, `${formatRelativeLedgerDate(entry.ledgerDate)} · ${entry.categoryNameSnapshot}`),
                  statusBadge(entry.status),
                ),
              ),
            ),
          ),
    ),

    el(
      'div',
      { class: 'alert alert--info' },
      'Phase 3 of 10. Entries are saved as drafts. Confirming, voucher numbers and running balances arrive in Phase 4.',
    ),
  );
}
