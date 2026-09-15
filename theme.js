/**
 * PMExps — Theme service
 *
 * The *initial* theme is applied by the inline bootstrap in each HTML file
 * before first paint; this module owns everything after that: switching,
 * persistence, and following the system setting when the user chose "system".
 *
 * @module services/theme
 */

import { THEME, STORAGE_KEY } from '../config/constants.js';

const SYSTEM_QUERY = '(prefers-color-scheme: light)';

/**
 * The user's stored preference — 'dark', 'light' or 'system'.
 * @returns {string}
 */
export function getPreference() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY.theme);
    return [THEME.DARK, THEME.LIGHT, THEME.SYSTEM].includes(stored)
      ? stored
      : THEME.DARK;
  } catch {
    return THEME.DARK; // Private browsing blocks localStorage.
  }
}

/**
 * The theme actually in effect, resolving 'system' against the OS setting.
 * @param {string} [preference]
 * @returns {'dark'|'light'}
 */
export function resolveTheme(preference = getPreference()) {
  if (preference !== THEME.SYSTEM) return preference;
  return window.matchMedia(SYSTEM_QUERY).matches ? THEME.LIGHT : THEME.DARK;
}

/**
 * Apply a preference: persist it, set `data-theme`, and update the browser
 * chrome colour so the status bar matches on mobile.
 *
 * The transition class is added only here, never on load, so navigating
 * between pages never animates colours.
 *
 * @param {string} preference
 * @param {{ animate?: boolean }} [options]
 * @returns {'dark'|'light'} the resolved theme
 */
export function setTheme(preference, options = {}) {
  const { animate = true } = options;
  const resolved = resolveTheme(preference);

  try {
    localStorage.setItem(STORAGE_KEY.theme, preference);
  } catch {
    /* Preference simply will not persist; the session still switches. */
  }

  if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.documentElement.classList.add('theme-transition');
    window.setTimeout(
      () => document.documentElement.classList.remove('theme-transition'),
      250,
    );
  }

  document.documentElement.setAttribute('data-theme', resolved);
  return resolved;
}

/** Cycle dark → light → system → dark. @returns {string} the new preference */
export function cycleTheme() {
  const order = [THEME.DARK, THEME.LIGHT, THEME.SYSTEM];
  const next = order[(order.indexOf(getPreference()) + 1) % order.length];
  setTheme(next);
  return next;
}

/**
 * Keep a 'system' preference in sync when the OS flips between light and dark
 * while the app is open.
 * @returns {() => void} unsubscribe
 */
export function watchSystemTheme() {
  const media = window.matchMedia(SYSTEM_QUERY);
  const onChange = () => {
    if (getPreference() === THEME.SYSTEM) {
      document.documentElement.setAttribute('data-theme', resolveTheme());
    }
  };
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
