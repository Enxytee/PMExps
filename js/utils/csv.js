/**
 * PMExps — CSV export
 *
 * Produces files that open correctly in Excel, LibreOffice and Google Sheets,
 * including Gujarati text, and that cannot be used to attack the person who
 * opens them.
 *
 * Three things here are easy to get wrong and expensive to discover later:
 *
 * 1. **Formula injection.** A spreadsheet treats a cell beginning with =, +,
 *    - or @ as a formula. A description typed as `=HYPERLINK("http://evil",
 *    "Click")` becomes a live link the moment an accountant opens the export,
 *    and some formulas can run commands. Any such cell is prefixed with an
 *    apostrophe, which spreadsheets strip on display but never execute.
 *
 * 2. **The byte-order mark.** Without a leading BOM, Excel on Windows reads a
 *    UTF-8 file as the local codepage, and every Gujarati character becomes
 *    mojibake. One three-byte prefix is the whole fix.
 *
 * 3. **Money as text, not as a float.** Amounts are written as plain decimal
 *    strings with no grouping, so a spreadsheet parses them as exact numbers.
 *    Writing "₹1,25,000.00" would give a text cell that cannot be summed.
 *
 * @module utils/csv
 */

import { paiseToInputString } from './money.js';

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_STARTERS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Escape one value for a CSV cell.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeCell(value) {
  if (value === null || value === undefined) return '';

  let text = String(value);

  // Neutralise formulas before quoting, so the apostrophe ends up inside the
  // quoted field where a spreadsheet will see it.
  if (FORMULA_STARTERS.some((char) => text.startsWith(char))) {
    text = `'${text}`;
  }

  // A field needs quoting if it contains a comma, a quote or a newline.
  // Embedded quotes are doubled, per RFC 4180.
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

/**
 * Build CSV text from a header row and data rows.
 * @param {string[]} headers
 * @param {Array<Array<unknown>>} rows
 * @returns {string}
 */
export function toCsv(headers, rows) {
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(','));
  }
  // CRLF line endings: required by RFC 4180 and by older Excel versions.
  return lines.join('\r\n');
}

/**
 * Format paise for a spreadsheet cell: a plain decimal, no symbol, no
 * grouping, so it parses as a number and can be summed.
 * @param {number} paise
 * @returns {string}
 */
export function csvAmount(paise) {
  if (typeof paise !== 'number' || !Number.isInteger(paise)) return '';
  return paiseToInputString(paise);
}

/**
 * Trigger a download of CSV text.
 *
 * The BOM is prepended here rather than in toCsv() so the same text can be
 * shown on screen or copied without a stray invisible character.
 *
 * @param {string} csvText
 * @param {string} fileName without extension
 */
export function downloadCsv(csvText, fileName) {
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${sanitiseFileName(fileName)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Revoking immediately can cancel the download in some browsers; a short
  // delay is the conventional and reliable fix.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Make a string safe as a file name on Windows, macOS and Linux.
 * @param {string} name
 * @returns {string}
 */
export function sanitiseFileName(name) {
  return String(name)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100) || 'pmexps-export';
}
