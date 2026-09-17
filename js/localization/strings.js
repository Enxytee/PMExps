/**
 * PMExps — Localisation
 *
 * Interface text lives here rather than scattered through the views, so
 * Gujarati can be extended without touching a single screen.
 *
 * Phase 8 covers the printed ledger, which is the part that genuinely needs
 * both languages: a page handed to an accountant, a partner or a tax adviser.
 * The rest of the interface follows in Phase 9 using this same structure.
 *
 * A note on Gujarati rendering. Gujarati joins letters into conjuncts and
 * places matras above, below and either side of the base character. Producing
 * that correctly requires text shaping, which the browser does properly and
 * which JavaScript PDF libraries do not — they place glyphs one after another
 * and the result is broken. This is why the printed page is HTML that the
 * browser renders and the user saves as PDF, rather than a file this app
 * generates itself.
 *
 * @module localization/strings
 */

export const STRINGS = {
  en: {
    // Document
    dailyLedger: 'Daily Ledger',
    report: 'Report',
    date: 'Date',
    generatedOn: 'Generated on',
    page: 'Page',
    of: 'of',

    // Table headers
    voucher: 'Voucher',
    description: 'Description',
    account: 'Account',
    category: 'Category',
    paymentMode: 'Mode',
    income: 'Income',
    expense: 'Expense',
    transfer: 'Transfer',
    balance: 'Balance',
    remarks: 'Remarks',

    // Totals
    openingBalance: 'Opening balance',
    closingBalance: 'Closing balance',
    totalIncome: 'Total income',
    totalExpense: 'Total expense',
    netCashFlow: 'Net for the day',
    dayTotal: 'Day total',
    entries: 'entries',

    // Footer
    preparedBy: 'Prepared by',
    signature: 'Signature',

    // Empty and notes
    noEntries: 'No entries recorded on this date.',
    transferNote:
      'Transfers move money between your own accounts. They are not income or expense.',
    draftNote: 'Drafts are not included. This page shows confirmed entries only.',

    // Share
    shareTitle: 'Daily Ledger Report',
  },

  gu: {
    // Document
    dailyLedger: 'રોજમેળ',
    report: 'અહેવાલ',
    date: 'તારીખ',
    generatedOn: 'તૈયાર કર્યાની તારીખ',
    page: 'પાનું',
    of: 'માંથી',

    // Table headers
    voucher: 'વાઉચર નં.',
    description: 'વિગત',
    account: 'ખાતું',
    category: 'પ્રકાર',
    paymentMode: 'ચુકવણી',
    income: 'આવક',
    expense: 'ખર્ચ',
    transfer: 'ફેરબદલ',
    balance: 'બાકી',
    remarks: 'નોંધ',

    // Totals
    openingBalance: 'શરૂઆતની બાકી',
    closingBalance: 'આખરી બાકી',
    totalIncome: 'કુલ આવક',
    totalExpense: 'કુલ ખર્ચ',
    netCashFlow: 'દિવસનો ચોખ્ખો',
    dayTotal: 'દિવસનો સરવાળો',
    entries: 'નોંધ',

    // Footer
    preparedBy: 'બનાવનાર',
    signature: 'સહી',

    // Empty and notes
    noEntries: 'આ તારીખે કોઈ નોંધ નથી.',
    transferNote:
      'ફેરબદલ એટલે પોતાનાં ખાતાં વચ્ચે રકમ ખસેડવી. તે આવક કે ખર્ચ ગણાતી નથી.',
    draftNote: 'અધૂરી નોંધ ગણતરીમાં નથી. આ પાનામાં ફક્ત પાકી નોંધ છે.',

    // Share
    shareTitle: 'રોજમેળ અહેવાલ',
  },
};

/**
 * Look up a string, falling back to English when a Gujarati translation is
 * missing. A missing translation should show readable English, never an empty
 * space or a raw key on a printed page someone hands to their accountant.
 *
 * @param {'en'|'gu'} locale
 * @param {string} key
 * @returns {string}
 */
export function t(locale, key) {
  return STRINGS[locale]?.[key] ?? STRINGS.en[key] ?? key;
}

/**
 * A translator bound to one locale, so a view calls `s('income')` rather than
 * threading the locale through every line.
 * @param {'en'|'gu'} locale
 * @returns {(key: string) => string}
 */
export function translator(locale) {
  return (key) => t(locale, key);
}

/**
 * The locale tag for Intl formatting. Gujarati dates and numbers use the
 * Indian conventions either way; only the script differs.
 * @param {'en'|'gu'} locale
 * @returns {string}
 */
export function intlLocale(locale) {
  return locale === 'gu' ? 'gu-IN' : 'en-IN';
}
