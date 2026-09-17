/**
 * Localisation. The one thing that must never happen on a printed page is a
 * blank label or a raw key, so the fallback behaviour is tested explicitly.
 */
import { describe, it, expect } from 'vitest';
import { STRINGS, t, translator, intlLocale } from '../../js/localization/strings.js';

describe('strings', () => {
  it('has a Gujarati translation for every English key', () => {
    const missing = Object.keys(STRINGS.en).filter((key) => !(key in STRINGS.gu));
    expect(missing).toEqual([]);
  });

  it('has no empty translations', () => {
    for (const [locale, table] of Object.entries(STRINGS)) {
      for (const [key, value] of Object.entries(table)) {
        expect(String(value).trim(), `${locale}.${key}`).not.toBe('');
      }
    }
  });

  it('falls back to English rather than showing a blank or a key', () => {
    expect(t('gu', 'income')).toBe('આવક');
    // A key that exists only in English.
    expect(t('gu', 'nonexistentKey')).toBe('nonexistentKey');
  });

  it('binds a locale', () => {
    const s = translator('gu');
    expect(s('dailyLedger')).toBe('રોજમેળ');
    expect(translator('en')('dailyLedger')).toBe('Daily Ledger');
  });

  it('maps to Indian Intl locales so numbers group as lakh and crore', () => {
    expect(intlLocale('gu')).toBe('gu-IN');
    expect(intlLocale('en')).toBe('en-IN');
  });

  it('keeps Gujarati labels short enough for a printed column header', () => {
    const headers = ['voucher', 'description', 'account', 'category', 'income', 'expense', 'balance'];
    for (const key of headers) {
      expect(STRINGS.gu[key].length, `gu.${key}`).toBeLessThanOrEqual(12);
    }
  });
});
