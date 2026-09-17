/**
 * PMExps — Reports
 *
 * One screen renders every report, because every report returns the same
 * shape from js/calculations/reports.js. The figures come from the same
 * arithmetic as the dashboard and the ledger, so a total here can never
 * disagree with a total there.
 *
 * @module views/reports
 */

import { el, replaceChildren, debounce } from '../utils/dom.js';
import { renderPage, pageHeader, goTo } from '../components/shell.js';
import { field, select, dateInput, textInput, toast } from '../components/ui.js';
import { getState, refreshMasterData } from '../state.js';
import { listRange, listUpTo } from '../repositories/entries.js';
import { listTransfers } from '../services/transfers.js';
import { listCorrections } from '../services/corrections.js';
import { formatPaise } from '../utils/money.js';
import { toCsv, csvAmount, downloadCsv } from '../utils/csv.js';
import {
  REPORT_TYPES, applyFilters, buildEntriesReport, buildAccountStatement,
  buildCategoryReport, buildMonthlyReport, buildUserReport,
  buildIncomeVsExpense, buildTransferReport, buildBalanceReport,
  buildCorrectionsReport,
} from '../calculations/reports.js';
import { todayLedgerDate, startOfMonth, endOfMonth, addMonths, formatLedgerDate } from '../utils/dates.js';
import { ENTRY_TYPE } from '../config/constants.js';

export async function renderReports(context) {
  await refreshMasterData();
  const { workspaceId, accounts, categories } = getState();

  const today = todayLedgerDate();
  const filters = {
    reportId: context.query.get('type') ?? 'range',
    from: startOfMonth(today),
    to: endOfMonth(today),
    accountId: '',
    categoryId: '',
    type: '',
    search: '',
  };

  /** @type {import('../calculations/reports.js').Report|null} */
  let report = null;
  let loading = false;

  async function build() {
    loading = true;
    draw();

    try {
      // A few reports need history from before the range to compute an
      // opening figure, so those load up to the end date rather than only the
      // window itself.
      const needsHistory = ['account', 'balances', 'range', 'daily'].includes(filters.reportId);
      const entries = needsHistory
        ? await listUpTo(workspaceId, filters.to)
        : await listRange(workspaceId, filters.from, filters.to);

      const filtered = applyFilters(entries, {
        ...filters,
        // History-based reports filter by date inside the builder instead, so
        // the pre-range entries survive long enough to form the opening.
        from: needsHistory ? undefined : filters.from,
        to: needsHistory ? undefined : filters.to,
      });

      report = await buildReport(filtered, entries);
    } catch (error) {
      console.error('[PMExps] Report failed', error);
      toast(error?.message ?? 'Could not build the report.', { tone: 'danger' });
      report = null;
    } finally {
      loading = false;
      draw();
    }
  }

  /** @param {any[]} filtered @param {any[]} all */
  async function buildReport(filtered, all) {
    const { from, to, reportId } = filters;

    switch (reportId) {
      case 'daily':
        return buildEntriesReport({
          entries: filtered.filter((e) => e.ledgerDate === to),
          accounts,
          from: to,
          to,
          title: 'Daily ledger',
        });

      case 'range':
        return buildEntriesReport({
          entries: filtered.filter((e) => e.ledgerDate >= from && e.ledgerDate <= to),
          accounts,
          from,
          to,
          title: 'Ledger',
        });

      case 'monthly':
        return buildMonthlyReport({ entries: filtered, from, to });

      case 'account': {
        const account = accounts.find((a) => a.accountId === filters.accountId) ?? accounts[0];
        if (!account) throw new Error('No accounts to report on.');
        return buildAccountStatement({ entries: filtered, account, from, to });
      }

      case 'categoryIncome':
        return buildCategoryReport({ entries: filtered, type: ENTRY_TYPE.INCOME, from, to });

      case 'categoryExpense':
        return buildCategoryReport({ entries: filtered, type: ENTRY_TYPE.EXPENSE, from, to });

      case 'user':
        return buildUserReport({ entries: filtered, from, to });

      case 'incomeVsExpense':
        return buildIncomeVsExpense({ entries: filtered, from, to });

      case 'transfers':
        return buildTransferReport({
          transfers: await listTransfers(workspaceId, 200),
          from,
          to,
        });

      case 'balances':
        return buildBalanceReport({ entries: all, accounts, from, to });

      case 'corrections':
        return buildCorrectionsReport({
          entries: all,
          corrections: await listCorrections(workspaceId),
          from,
          to,
        });

      default:
        throw new Error('Unknown report.');
    }
  }

  function exportCsv() {
    if (!report) return;

    const headers = report.columns.map((c) => c.label);
    const rows = report.rows.map((row) =>
      report.columns.map((column) =>
        column.money ? csvAmount(row[column.key] ?? 0) : (row[column.key] ?? ''),
      ),
    );

    // The totals line is appended as a row rather than left off, so a printed
    // or emailed export carries the same bottom line the screen showed.
    if (report.totals) {
      rows.push([]);
      rows.push(
        report.columns.map((column, index) => {
          if (index === 0) return `TOTAL (${report.totals.label ?? ''})`;
          const value = report.totals[column.key];
          return value === undefined || value === null
            ? ''
            : column.money
              ? csvAmount(value)
              : value;
        }),
      );
    }

    downloadCsv(toCsv(headers, rows), `${report.title}-${filters.from}-to-${filters.to}`);
    toast('CSV downloaded. It opens in Excel with amounts as numbers.');
  }

  const onSearch = debounce((value) => {
    filters.search = value;
    build();
  }, 300);

  function draw() {
    const needsAccount = filters.reportId === 'account';

    renderPage(
      pageHeader({
        title: 'Reports',
        subtitle: 'Confirmed entries only. Drafts are never counted.',
        actions: [
          el(
            'button',
            { class: 'btn', type: 'button', onClick: () => window.print(), disabled: !report },
            'Print',
          ),
          el(
            'button',
            { class: 'btn btn--primary', type: 'button', onClick: exportCsv, disabled: !report },
            'Export CSV',
          ),
        ],
      }),

      el(
        'section',
        { class: 'card stack no-print' },
        el(
          'div',
          { class: 'grid grid--halves' },
          field({
            label: 'Report',
            control: select({
              value: filters.reportId,
              options: REPORT_TYPES.map((r) => ({ value: r.id, label: r.label })),
              onChange: (value) => { filters.reportId = value; build(); },
            }),
          }),
          needsAccount &&
            field({
              label: 'Account',
              control: select({
                value: filters.accountId || accounts[0]?.accountId || '',
                options: accounts.map((a) => ({ value: a.accountId, label: a.name })),
                onChange: (value) => { filters.accountId = value; build(); },
              }),
            }),
        ),

        el(
          'div',
          { class: 'grid grid--halves' },
          field({
            label: 'From',
            control: dateInput({ value: filters.from, onChange: (v) => { filters.from = v; build(); } }),
          }),
          field({
            label: 'To',
            control: dateInput({ value: filters.to, onChange: (v) => { filters.to = v; build(); } }),
          }),
        ),

        el(
          'div',
          { class: 'row row--wrap u-gap-2' },
          quickRange('This month', startOfMonth(today), endOfMonth(today)),
          quickRange('Last month', startOfMonth(addMonths(today, -1)), endOfMonth(addMonths(today, -1))),
          quickRange('This quarter', startOfMonth(addMonths(today, -2)), endOfMonth(today)),
          quickRange('Financial year', fyStart(today), today),
        ),

        el(
          'div',
          { class: 'grid grid--halves' },
          field({
            label: 'Category',
            control: select({
              value: filters.categoryId,
              placeholder: 'All categories',
              options: [{ value: '', label: 'All categories' }].concat(
                categories.map((c) => ({ value: c.categoryId, label: `${c.name} (${c.type})` })),
              ),
              onChange: (value) => { filters.categoryId = value; build(); },
            }),
          }),
          field({
            label: 'Search',
            control: textInput({
              value: filters.search,
              placeholder: 'Description, party, reference, voucher',
              onInput: onSearch,
            }),
          }),
        ),
      ),

      loading
        ? el(
            'div',
            { class: 'stack' },
            el('div', { class: 'skeleton', style: { height: '28px', width: '260px' } }),
            el('div', { class: 'skeleton', style: { height: '180px' } }),
            el('p', { class: 'sr-only', role: 'status' }, 'Building report'),
          )
        : report
          ? reportTable(report)
          : el('div', { class: 'empty-state' }, el('p', {}, 'Choose a report above.')),
    );
  }

  /** @param {string} label @param {string} from @param {string} to */
  function quickRange(label, from, to) {
    return el(
      'button',
      {
        class: 'btn btn--ghost u-text-sm',
        type: 'button',
        onClick: () => { filters.from = from; filters.to = to; build(); },
      },
      label,
    );
  }

  await build();
}

/** @param {string} ledgerDate @returns {string} 1 April of the current financial year */
function fyStart(ledgerDate) {
  const [year, month] = ledgerDate.split('-').map(Number);
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-04-01`;
}

/** @param {import('../calculations/reports.js').Report} report */
function reportTable(report) {
  return el(
    'section',
    { class: 'stack report-sheet' },
    el(
      'header',
      { class: 'stack stack--tight' },
      el('h2', {}, report.title),
      el('p', { class: 'u-text-secondary u-text-sm' }, report.subtitle),
    ),

    report.rows.length === 0
      ? el(
          'div',
          { class: 'empty-state' },
          el('p', { class: 'u-weight-medium' }, 'Nothing in this period'),
          el('p', { class: 'u-text-sm' }, 'Widen the dates, or clear the filters.'),
        )
      : el(
          'div',
          { style: { 'overflow-x': 'auto' } },
          el(
            'table',
            { class: 'ledger-table', 'aria-label': report.title },
            el(
              'thead',
              {},
              el(
                'tr',
                {},
                ...report.columns.map((column) =>
                  el(
                    'th',
                    { scope: 'col', class: column.align === 'right' ? 'money' : null },
                    column.label,
                  ),
                ),
              ),
            ),
            el(
              'tbody',
              {},
              ...report.rows.map((row) =>
                el(
                  'tr',
                  {},
                  ...report.columns.map((column) =>
                    el(
                      'td',
                      { class: column.align === 'right' ? 'money' : null },
                      cellValue(row, column),
                    ),
                  ),
                ),
              ),
            ),
            report.totals && totalsRow(report),
          ),
        ),

    report.notes?.length &&
      el(
        'div',
        { class: 'stack stack--tight' },
        ...report.notes.map((note) => el('p', { class: 'u-text-xs u-text-muted' }, note)),
      ),
  );
}

function cellValue(row, column) {
  const value = row[column.key];
  if (column.money) {
    // A zero in a money column is printed blank, so the eye follows the
    // figures that matter rather than a wall of 0.00.
    return value === 0 || value === null || value === undefined
      ? ''
      : formatPaise(value, { symbol: false });
  }
  if (column.key === 'ledgerDate' && value) return formatLedgerDate(value, { style: 'short' });
  if (value === null || value === undefined) return '';
  return String(value);
}

function totalsRow(report) {
  return el(
    'tfoot',
    {},
    el(
      'tr',
      { class: 'ledger-row--closing' },
      ...report.columns.map((column, index) => {
        if (index === 0) {
          return el('td', { class: 'u-weight-semibold' }, report.totals.label ?? 'Total');
        }
        const value = report.totals[column.key];
        return el(
          'td',
          { class: column.align === 'right' ? 'money u-weight-semibold' : null },
          value === undefined || value === null
            ? ''
            : column.money
              ? formatPaise(value, { symbol: false })
              : String(value),
        );
      }),
    ),
  );
}
