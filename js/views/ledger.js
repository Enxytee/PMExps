/**
 * PMExps — Ledger, drafts and dashboard
 *
 * Every figure on these screens is computed from ledger entries by
 * js/calculations/balances.js. Nothing is read from a stored total, so the
 * dashboard and the ledger cannot disagree.
 *
 * @module views/ledger
 */

import { el } from '../utils/dom.js';
import { renderPage, pageHeader, goTo } from '../components/shell.js';
import { toast, confirmDialog, dateInput, setBusy } from '../components/ui.js';
import { getState, refreshMasterData } from '../state.js';
import { listByDate, listDrafts, listRecent, listUpTo, voidDraft } from '../repositories/entries.js';
import { confirmEntry, confirmMany, getLockDate } from '../services/confirm.js';
import { formatPaise } from '../utils/money.js';
import {
  summariseEntries,
  summariseDrafts,
  accountBalances,
  overallBalance,
  dailyPosition,
  withRunningBalance,
  categoryTotals,
} from '../calculations/balances.js';
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
    status === ENTRY_STATUS.DRAFT ? 'draft' : status === ENTRY_STATUS.LOCKED ? 'locked' : 'confirmed';
  return el('span', { class: `badge badge--${modifier}` }, STATUS_LABEL[status] ?? status);
}

/**
 * Direction is carried by an explicit word for screen readers, a sign for
 * everyone, and colour only as a third layer.
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

function summaryCard(label, value, detail) {
  return el(
    'article',
    { class: 'card' },
    el('p', { class: 'u-text-muted u-text-xs' }, label),
    el('p', { class: 'u-text-xl u-weight-semibold tnum' }, value),
    el('p', { class: 'u-text-muted u-text-xs' }, detail),
  );
}

/** Voucher number, or a clear placeholder while a draft has none. */
function voucherCell(entry) {
  return entry.voucherNumber
    ? el('span', { class: 'tnum u-text-xs' }, entry.voucherNumber)
    : el('span', { class: 'u-text-muted u-text-xs' }, '—');
}

/* -------------------------------------------------------------------------
   Daily ledger
   ------------------------------------------------------------------------- */

/** @param {import('../router.js').RouteContext} context */
export async function renderLedger(context) {
  await refreshMasterData();
  const { workspaceId, role, accounts } = getState();
  let ledgerDate = context.query.get('date') ?? todayLedgerDate();

  async function draw() {
    const [dayEntries, history, lockDate] = await Promise.all([
      listByDate(workspaceId, ledgerDate),
      listUpTo(workspaceId, ledgerDate),
      getLockDate(workspaceId),
    ]);

    const confirmed = dayEntries.filter((e) => e.status !== ENTRY_STATUS.DRAFT);
    const drafts = dayEntries.filter((e) => e.status === ENTRY_STATUS.DRAFT);

    const position = dailyPosition(accounts, history, ledgerDate);
    const sums = summariseEntries(confirmed);
    const draftSums = summariseDrafts(drafts);

    // Oldest first so the running balance reads downward the way a paper
    // ledger does.
    const ordered = [...confirmed].reverse();
    const withRunning = withRunningBalance(ordered, position.openingPaise);

    const datePicker = dateInput({
      value: ledgerDate,
      onChange: (value) => {
        if (!value) return;
        ledgerDate = value;
        draw();
      },
    });
    datePicker.id = 'ledger-date';

    const isLocked = lockDate && ledgerDate <= lockDate;

    renderPage(
      pageHeader({
        title: 'Daily ledger',
        subtitle: formatLedgerDate(ledgerDate, { style: 'long' }),
        actions: [
          el('button', { class: 'btn', type: 'button', onClick: () => { ledgerDate = addDays(ledgerDate, -1); draw(); } }, 'Previous'),
          el('button', { class: 'btn', type: 'button', onClick: () => { ledgerDate = todayLedgerDate(); draw(); } }, 'Today'),
          el('button', { class: 'btn', type: 'button', onClick: () => { ledgerDate = addDays(ledgerDate, 1); draw(); } }, 'Next'),
          role !== ROLE.VIEWER &&
            el('button', { class: 'btn btn--primary', type: 'button', onClick: () => goTo('/entry/new') }, 'Add entry'),
        ],
      }),

      el(
        'div',
        { class: 'field', style: { 'max-width': '220px' } },
        el('label', { class: 'field__label', for: 'ledger-date' }, 'Jump to date'),
        datePicker,
      ),

      isLocked &&
        el('div', { class: 'alert alert--info' }, `This date is in a closed period (locked up to ${lockDate}). Entries here cannot be changed or confirmed.`),

      el(
        'section',
        { class: 'grid grid--summary', 'aria-label': 'Day totals' },
        summaryCard('Opening balance', formatPaise(position.openingPaise), 'Across active accounts'),
        summaryCard('Income', formatPaise(sums.incomePaise), `${sums.incomeCount} confirmed`),
        summaryCard('Expenses', formatPaise(sums.expensePaise), `${sums.expenseCount} confirmed`),
        summaryCard('Closing balance', formatPaise(position.closingPaise), 'Opening + income − expenses'),
      ),

      drafts.length > 0 &&
        el(
          'div',
          { class: 'alert alert--warning row row--between' },
          el('span', {}, `${drafts.length} draft ${drafts.length === 1 ? 'entry is' : 'entries are'} not counted above (${formatPaise(draftSums.netPaise, { signed: true })} net).`),
          el('button', { class: 'btn', type: 'button', onClick: () => goTo('/drafts') }, 'Review drafts'),
        ),

      dayEntries.length === 0
        ? el(
            'div',
            { class: 'empty-state' },
            el('p', { class: 'u-weight-medium' }, 'Nothing recorded on this date'),
            el('p', { class: 'u-text-sm' }, 'Use Add entry to record income or an expense.'),
          )
        : el('div', {}, ledgerTable(withRunning, drafts, position), ledgerCards([...drafts, ...ordered])),
    );
  }

  await draw();
}

/**
 * @param {any[]} confirmedWithRunning
 * @param {any[]} drafts
 * @param {{openingPaise: number, closingPaise: number}} position
 */
function ledgerTable(confirmedWithRunning, drafts, position) {
  const rows = [];

  rows.push(
    el(
      'tr',
      { class: 'ledger-row--opening' },
      el('td', { colspan: '6', class: 'u-text-muted u-text-xs' }, 'Opening balance'),
      el('td', { class: 'money u-weight-medium' }, formatPaise(position.openingPaise, { symbol: false })),
    ),
  );

  for (const entry of confirmedWithRunning) {
    rows.push(
      el(
        'tr',
        {},
        el('td', {}, voucherCell(entry)),
        el(
          'td',
          {},
          el('span', { class: 'u-weight-medium' }, entry.description),
          entry.partyName && el('span', { class: 'u-text-muted u-text-xs' }, ` · ${entry.partyName}`),
        ),
        el('td', {}, entry.categoryNameSnapshot),
        el('td', {}, entry.accountNameSnapshot),
        el(
          'td',
          {},
          statusBadge(entry.status),
          // A confirmed entry cannot be edited, so the only honest action
          // offered here is a correction. Once corrected, the link is
          // replaced by a note pointing at the reversal.
          entry.correctedBy
            ? el('span', { class: 'u-text-xs u-text-muted' }, ' corrected')
            : !entry.transferId &&
              el(
                'button',
                {
                  class: 'btn btn--ghost u-text-xs',
                  type: 'button',
                  onClick: () => goTo(`/correct/${entry.entryId}`),
                },
                'Correct',
              ),
        ),
        el('td', { class: 'money' }, amountCell(entry)),
        el('td', { class: 'money tnum' }, formatPaise(entry.runningPaise, { symbol: false })),
      ),
    );
  }

  for (const entry of drafts) {
    rows.push(
      el(
        'tr',
        { class: 'ledger-row--draft' },
        el('td', {}, voucherCell(entry)),
        el('td', {}, el('span', { class: 'u-weight-medium' }, entry.description)),
        el('td', {}, entry.categoryNameSnapshot),
        el('td', {}, entry.accountNameSnapshot),
        el('td', {}, statusBadge(entry.status)),
        el('td', { class: 'money' }, amountCell(entry)),
        // A draft has no place in the running balance, so the cell says so
        // rather than repeating the previous row's figure.
        el('td', { class: 'money u-text-muted' }, 'not counted'),
      ),
    );
  }

  rows.push(
    el(
      'tr',
      { class: 'ledger-row--closing' },
      el('td', { colspan: '6', class: 'u-weight-semibold' }, 'Closing balance'),
      el('td', { class: 'money u-weight-semibold' }, formatPaise(position.closingPaise, { symbol: false })),
    ),
  );

  return el(
    'table',
    { class: 'ledger-table', 'aria-label': 'Entries for this date' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { scope: 'col' }, 'Voucher'),
        el('th', { scope: 'col' }, 'Description'),
        el('th', { scope: 'col' }, 'Category'),
        el('th', { scope: 'col' }, 'Account'),
        el('th', { scope: 'col' }, 'Status'),
        el('th', { scope: 'col', class: 'money' }, 'Amount'),
        el('th', { scope: 'col', class: 'money' }, 'Balance'),
      ),
    ),
    el('tbody', {}, ...rows),
  );
}

/** @param {any[]} entries */
function ledgerCards(entries) {
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
        entry.voucherNumber && el('p', { class: 'u-text-xs u-text-muted tnum' }, entry.voucherNumber),
      ),
    ),
  );
}

/* -------------------------------------------------------------------------
   Drafts — where confirmation happens
   ------------------------------------------------------------------------- */

export async function renderDrafts() {
  await refreshMasterData();
  const { workspaceId } = getState();

  async function draw() {
    const drafts = await listDrafts(workspaceId, {});

    async function doConfirm(entry, button) {
      const ok = await confirmDialog({
        title: 'Confirm this entry?',
        message: `${entry.description} — ${formatPaise(entry.amountPaise)} on ${entry.ledgerDate}. Once confirmed it gets a permanent voucher number, counts in every balance, and cannot be edited. Changing it afterwards needs a correction, which keeps the original on record.`,
        confirmLabel: 'Confirm entry',
      });
      if (!ok) return;

      const restore = setBusy(button, 'Confirming…');
      try {
        const result = await confirmEntry({ workspaceId, entryId: entry.entryId });
        toast(
          result.alreadyConfirmed
            ? `Already confirmed as ${result.voucherNumber}`
            : `Confirmed as ${result.voucherNumber}`,
        );
        draw();
      } catch (error) {
        toast(error?.message ?? 'Could not confirm.', { tone: 'danger', duration: 7000 });
        restore();
      }
    }

    const confirmAllButton = el(
      'button',
      {
        class: 'btn',
        type: 'button',
        onClick: async () => {
          const ok = await confirmDialog({
            title: `Confirm all ${drafts.length} drafts?`,
            message:
              'Each gets its own voucher number, in the order shown. Any that fail are reported and stay as drafts.',
            confirmLabel: 'Confirm all',
          });
          if (!ok) return;

          const restore = setBusy(confirmAllButton, 'Confirming…');
          const { confirmed, failed } = await confirmMany(
            workspaceId,
            drafts.map((d) => d.entryId),
          );
          restore();

          if (failed.length === 0) {
            toast(`Confirmed ${confirmed.length} entries`);
          } else {
            toast(`${confirmed.length} confirmed, ${failed.length} failed. ${failed[0].message}`, {
              tone: 'warning',
              duration: 8000,
            });
          }
          draw();
        },
      },
      'Confirm all',
    );

    renderPage(
      pageHeader({
        title: 'Drafts',
        subtitle: 'Not counted in any balance until confirmed.',
        actions: [
          drafts.length > 1 && confirmAllButton,
          el('button', { class: 'btn btn--primary', type: 'button', onClick: () => goTo('/entry/new') }, 'Add entry'),
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
            ...drafts.map((entry) => {
              const confirmButton = el('button', { class: 'btn btn--primary', type: 'button' }, 'Confirm');
              confirmButton.addEventListener('click', () => doConfirm(entry, confirmButton));

              return el(
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
                  confirmButton,
                  el('button', { class: 'btn', type: 'button', onClick: () => goTo(`/entry/${entry.entryId}`) }, 'Edit'),
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
              );
            }),
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

  const [history, recent, drafts] = await Promise.all([
    listUpTo(workspaceId, today),
    listRecent(workspaceId, 8),
    listDrafts(workspaceId, {}),
  ]);

  const todayEntries = history.filter((e) => e.ledgerDate === today);
  const sums = summariseEntries(todayEntries);
  const balances = accountBalances(accounts, history);
  const overall = overallBalance(balances);
  const expenseByCategory = categoryTotals(history, ENTRY_TYPE.EXPENSE).slice(0, 6);

  const firstName = String(membership?.displayNameSnapshot ?? '').split(' ')[0];

  renderPage(
    pageHeader({
      title: firstName ? `Welcome, ${firstName}` : 'Dashboard',
      subtitle: formatLedgerDate(today, { style: 'long' }),
      actions: [
        role !== ROLE.VIEWER &&
          el('button', { class: 'btn btn--primary', type: 'button', onClick: () => goTo('/entry/new') }, 'Add entry'),
      ],
    }),

    el(
      'section',
      { class: 'grid grid--summary', 'aria-label': 'Today' },
      summaryCard("Today's income", formatPaise(sums.incomePaise), 'Confirmed only'),
      summaryCard("Today's expenses", formatPaise(sums.expensePaise), 'Confirmed only'),
      summaryCard('Net cash flow', formatPaise(sums.netPaise), 'Income minus expenses'),
      summaryCard('Overall balance', formatPaise(overall.activePaise), 'Across active accounts'),
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
      el('h2', {}, 'Account balances'),
      el(
        'div',
        { class: 'grid grid--summary' },
        ...balances
          .filter((b) => b.isActive)
          .map((balance) =>
            el(
              'article',
              { class: 'card' },
              el('p', { class: 'u-text-muted u-text-xs' }, balance.name),
              el('p', { class: 'u-text-lg u-weight-semibold tnum' }, formatPaise(balance.closingPaise)),
              el(
                'p',
                { class: 'card__meta' },
                `Opening ${formatPaise(balance.openingPaise, { symbol: false })} · movement ${formatPaise(balance.movementPaise, { symbol: false, signed: true })}`,
              ),
            ),
          ),
      ),
    ),

    expenseByCategory.length > 0 &&
      el(
        'section',
        { class: 'stack' },
        el('h2', {}, 'Expenses by category'),
        el(
          'div',
          { class: 'card stack stack--tight' },
          ...expenseByCategory.map((category) =>
            el(
              'div',
              { class: 'row row--between u-text-sm' },
              el('span', {}, `${category.name} (${category.count})`),
              el('span', { class: 'money tnum' }, formatPaise(category.totalPaise, { symbol: false })),
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
                  el('span', {}, `${formatRelativeLedgerDate(entry.ledgerDate)} · ${entry.voucherNumber ?? 'draft'}`),
                  statusBadge(entry.status),
                ),
              ),
            ),
          ),
    ),

    el(
      'div',
      { class: 'alert alert--info' },
      'Phase 7 of 10. Reports with CSV export are live. A4 PDF and WhatsApp sharing arrive next.',
    ),
  );
}
