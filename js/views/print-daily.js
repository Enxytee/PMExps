/**
 * PMExps — Printable daily ledger
 *
 * An A4 page the browser renders and the user saves as PDF with Ctrl+P.
 *
 * Why not generate the PDF in JavaScript: Gujarati joins letters into
 * conjuncts and positions matras around the base character, which requires
 * text shaping. Browsers do this correctly. The JavaScript PDF libraries do
 * not — they place glyphs sequentially, and Gujarati comes out broken while
 * English looks fine, so the fault is easy to ship without noticing. Letting
 * the browser lay the page out and print it means the Gujarati is correct by
 * construction, no font file has to be downloaded, and it works offline.
 *
 * The cost is that the person saves the file themselves rather than the app
 * handing them one. For a page that is usually printed anyway, that is a
 * trade worth making.
 *
 * @module views/print-daily
 */

import { el, qs, replaceChildren } from '../utils/dom.js';
import { getState, refreshMasterData } from '../state.js';
import { listByDate, listUpTo } from '../repositories/entries.js';
import { formatPaise } from '../utils/money.js';
import {
  summariseEntries,
  dailyPosition,
  withRunningBalance,
  accountEffect,
  isTransferLeg,
} from '../calculations/balances.js';
import { formatLedgerDate, todayLedgerDate, formatTimestamp } from '../utils/dates.js';
import { translator, intlLocale } from '../localization/strings.js';
import { ENTRY_STATUS, ENTRY_TYPE, STORAGE_KEY } from '../config/constants.js';
import { toast } from '../components/ui.js';
import { db, firestore } from '../firebase/init.js';

const { doc, getDoc } = firestore;

/** @type {'en'|'gu'} */
let printLocale = readStoredLocale();

function readStoredLocale() {
  try {
    return localStorage.getItem('pmexps:printLocale') === 'gu' ? 'gu' : 'en';
  } catch {
    return 'en';
  }
}

/** @param {'en'|'gu'} locale */
function storeLocale(locale) {
  try {
    localStorage.setItem('pmexps:printLocale', locale);
  } catch {
    /* Private browsing; the choice just will not persist. */
  }
}

/**
 * @param {import('../router.js').RouteContext} context
 */
export async function renderPrintDaily(context) {
  await refreshMasterData();
  const { workspaceId, accounts, user } = getState();
  const ledgerDate = context.query.get('date') ?? todayLedgerDate();

  const [dayEntries, history, workspaceSnapshot] = await Promise.all([
    listByDate(workspaceId, ledgerDate),
    listUpTo(workspaceId, ledgerDate),
    getDoc(doc(db, 'workspaces', workspaceId)),
  ]);

  const workspace = workspaceSnapshot.exists() ? workspaceSnapshot.data() : {};
  const confirmed = dayEntries.filter((e) => e.status !== ENTRY_STATUS.DRAFT);
  const draftCount = dayEntries.length - confirmed.length;

  function draw() {
    const s = translator(printLocale);
    const locale = intlLocale(printLocale);

    const position = dailyPosition(accounts, history, ledgerDate);
    const sums = summariseEntries(confirmed);

    const ordered = [...confirmed].sort((a, b) => {
      const byVoucher = (a.voucherNumber ?? '').localeCompare(b.voucherNumber ?? '');
      return byVoucher;
    });
    const rows = withRunningBalance(ordered, position.openingPaise);

    const businessName = workspace.businessName || workspace.name || 'PMExps';

    replaceChildren(
      qs('#app'),

      // Controls. Excluded from print by .no-print, so they never appear on
      // the page that is handed to someone.
      el(
        'div',
        { class: 'print-controls no-print' },
        el(
          'button',
          {
            class: 'btn',
            type: 'button',
            onClick: () => { window.location.hash = `#/ledger?date=${ledgerDate}`; },
          },
          '← Back',
        ),
        el(
          'div',
          { class: 'row u-gap-2' },
          languageButton('en', 'English', s),
          languageButton('gu', 'ગુજરાતી', s),
        ),
        el(
          'div',
          { class: 'row u-gap-2' },
          el(
            'button',
            { class: 'btn btn--primary', type: 'button', onClick: () => window.print() },
            'Print / Save as PDF',
          ),
          el(
            'button',
            { class: 'btn', type: 'button', onClick: () => shareOnWhatsApp(sums, position, ledgerDate, businessName, s, locale) },
            'Share on WhatsApp',
          ),
        ),
      ),

      el(
        'div',
        { class: 'no-print', style: { 'max-width': '210mm', margin: '0 auto var(--space-4)' } },
        el(
          'div',
          { class: 'alert alert--info' },
          'Press Print, then choose "Save as PDF" as the destination. The controls above are not printed.',
        ),
        draftCount > 0 &&
          el(
            'div',
            { class: 'alert alert--warning' },
            `${draftCount} draft ${draftCount === 1 ? 'entry is' : 'entries are'} dated today and are not on this page. Confirm them first if they belong in the report.`,
          ),
      ),

      // The sheet itself.
      el(
        'article',
        { class: 'a4-sheet', lang: printLocale },

        el(
          'header',
          { class: 'a4-header' },
          el(
            'div',
            {},
            el('h1', { class: 'a4-business' }, businessName),
            workspace.address && el('p', { class: 'a4-meta' }, workspace.address),
            (workspace.contactPhone || workspace.contactEmail) &&
              el(
                'p',
                { class: 'a4-meta' },
                [workspace.contactPhone, workspace.contactEmail].filter(Boolean).join(' · '),
              ),
          ),
          el(
            'div',
            { class: 'a4-title-block' },
            el('h2', { class: 'a4-title' }, s('dailyLedger')),
            el(
              'p',
              { class: 'a4-meta' },
              `${s('date')}: ${formatLedgerDate(ledgerDate, { style: 'long', locale })}`,
            ),
          ),
        ),

        rows.length === 0
          ? el('p', { class: 'a4-empty' }, s('noEntries'))
          : el(
              'table',
              { class: 'a4-table' },
              el(
                'thead',
                {},
                el(
                  'tr',
                  {},
                  el('th', { scope: 'col' }, s('voucher')),
                  el('th', { scope: 'col' }, s('description')),
                  el('th', { scope: 'col' }, s('account')),
                  el('th', { scope: 'col' }, s('category')),
                  el('th', { scope: 'col', class: 'money' }, s('income')),
                  el('th', { scope: 'col', class: 'money' }, s('expense')),
                  el('th', { scope: 'col', class: 'money' }, s('balance')),
                ),
              ),
              el(
                'tbody',
                {},
                el(
                  'tr',
                  { class: 'a4-row--opening' },
                  el('td', { colspan: '6' }, s('openingBalance')),
                  el('td', { class: 'money' }, formatPaise(position.openingPaise, { symbol: false, locale })),
                ),
                ...rows.map((entry) => printRow(entry, s, locale)),
              ),
              // tfoot repeats on every page in print, so the closing figures
              // are never orphaned from the rows above them.
              el(
                'tfoot',
                {},
                el(
                  'tr',
                  { class: 'a4-row--total' },
                  el('td', { colspan: '4' }, `${s('dayTotal')} (${rows.length} ${s('entries')})`),
                  el('td', { class: 'money' }, formatPaise(sums.incomePaise, { symbol: false, locale })),
                  el('td', { class: 'money' }, formatPaise(sums.expensePaise, { symbol: false, locale })),
                  el('td', {}),
                ),
                el(
                  'tr',
                  { class: 'a4-row--closing' },
                  el('td', { colspan: '6' }, s('closingBalance')),
                  el('td', { class: 'money' }, formatPaise(position.closingPaise, { symbol: false, locale })),
                ),
              ),
            ),

        el(
          'footer',
          { class: 'a4-footer' },
          el(
            'div',
            { class: 'a4-notes' },
            el('p', {}, s('draftNote')),
            rows.some(isTransferLeg) && el('p', {}, s('transferNote')),
          ),
          el(
            'div',
            { class: 'a4-signature' },
            el('div', { class: 'a4-signature__line' }),
            el('p', {}, s('preparedBy')),
            el('p', { class: 'a4-meta' }, user?.displayName || user?.email || ''),
          ),
        ),

        el(
          'p',
          { class: 'a4-generated' },
          `${s('generatedOn')}: ${formatTimestamp(new Date(), { locale })}`,
        ),
      ),
    );
  }

  /** @param {'en'|'gu'} value @param {string} label */
  function languageButton(value, label) {
    const isActive = printLocale === value;
    return el(
      'button',
      {
        class: `btn${isActive ? ' btn--primary' : ''}`,
        type: 'button',
        'aria-pressed': String(isActive),
        onClick: () => {
          printLocale = value;
          storeLocale(value);
          draw();
        },
      },
      label,
    );
  }

  draw();
}

/**
 * One printed row. Income and expense columns follow the account's movement,
 * because on a daily sheet a transfer genuinely did take money out of one
 * account and put it into another, and the running balance beside it must
 * agree.
 * @param {Record<string, any>} entry
 * @param {(key: string) => string} s
 * @param {string} locale
 */
function printRow(entry, s, locale) {
  const effect = accountEffect(entry);
  const inPaise = effect > 0 ? effect : 0;
  const outPaise = effect < 0 ? -effect : 0;

  return el(
    'tr',
    {},
    el('td', { class: 'a4-voucher' }, entry.voucherNumber ?? ''),
    el(
      'td',
      {},
      entry.description,
      entry.partyName && el('span', { class: 'a4-party' }, ` — ${entry.partyName}`),
    ),
    el('td', {}, entry.accountNameSnapshot),
    el('td', {}, isTransferLeg(entry) ? s('transfer') : entry.categoryNameSnapshot),
    el('td', { class: 'money' }, inPaise ? formatPaise(inPaise, { symbol: false, locale }) : ''),
    el('td', { class: 'money' }, outPaise ? formatPaise(outPaise, { symbol: false, locale }) : ''),
    el('td', { class: 'money' }, formatPaise(entry.runningPaise, { symbol: false, locale })),
  );
}

/* -------------------------------------------------------------------------
   WhatsApp
   ------------------------------------------------------------------------- */

/**
 * Share the day's figures on WhatsApp.
 *
 * What this does NOT do is attach the PDF automatically. A web page cannot
 * hand a file to WhatsApp unless the browser supports sharing files, and even
 * then the PDF would have to exist first — and this app deliberately does not
 * generate one, for the Gujarati reasons above. Claiming otherwise would mean
 * a person presses Share, sees WhatsApp open, sends the message, and never
 * notices the attachment is missing.
 *
 * So the message carries the figures themselves, which is what the recipient
 * usually wants anyway, and the text says plainly that the full page is
 * separate.
 */
function shareOnWhatsApp(sums, position, ledgerDate, businessName, s, locale) {
  const lines = [
    `*${businessName}*`,
    `${s('dailyLedger')} — ${formatLedgerDate(ledgerDate, { style: 'medium', locale })}`,
    '',
    `${s('openingBalance')}: ₹${formatPaise(position.openingPaise, { symbol: false, locale })}`,
    `${s('totalIncome')}: ₹${formatPaise(sums.incomePaise, { symbol: false, locale })}`,
    `${s('totalExpense')}: ₹${formatPaise(sums.expensePaise, { symbol: false, locale })}`,
    `${s('closingBalance')}: ₹${formatPaise(position.closingPaise, { symbol: false, locale })}`,
  ];

  const text = lines.join('\n');

  // The Web Share API gives the native sheet on a phone, which is the better
  // experience where it exists. Text only — no file, for the reason above.
  if (navigator.share) {
    navigator
      .share({ title: `${s('shareTitle')} ${ledgerDate}`, text })
      .catch((error) => {
        // An abort means the person closed the sheet. That is not a failure
        // and should not produce an error message.
        if (error?.name !== 'AbortError') openWhatsAppLink(text);
      });
    return;
  }

  openWhatsAppLink(text);
}

/** @param {string} text */
function openWhatsAppLink(text) {
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  toast(
    'WhatsApp opened with the day\u2019s figures. To send the full page, use Print → Save as PDF first, then attach it.',
    { duration: 8000 },
  );
}
