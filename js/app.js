/**
 * PMExps — Application entry point
 *
 * Phase 1 scope: bootstrap the shell, prove the design system and the build
 * pipeline end to end, and report the deployment environment so a GitHub Pages
 * base-path problem is visible immediately rather than as a silent 404.
 *
 * Authentication, routing and the real screens arrive in Phase 2. This file is
 * replaced by the router at that point.
 *
 * @module app
 */

import { el, replaceChildren, qs, announce } from './utils/dom.js';
import { basePath, isProjectSite, absoluteUrl } from './utils/base-path.js';
import { todayLedgerDate, formatLedgerDate, financialYear } from './utils/dates.js';
import { formatPaise } from './utils/money.js';
import { APP } from './config/constants.js';
import { firebaseConfig } from './config/firebase-config.js';
import { getPreference, setTheme, cycleTheme, watchSystemTheme } from './services/theme.js';

/** Render the interim shell. */
function render() {
  const root = qs('#app');
  if (!root) return;

  const today = todayLedgerDate();
  const fy = financialYear(today);

  const themeButton = el(
    'button',
    {
      class: 'btn',
      type: 'button',
      'aria-label': 'Change theme',
      onClick: () => {
        const next = cycleTheme();
        themeButton.textContent = `Theme: ${next}`;
        announce(`Theme set to ${next}`);
      },
    },
    `Theme: ${getPreference()}`,
  );

  replaceChildren(
    root,
    el(
      'main',
      { id: 'main-content', class: 'app-main' },
      el(
        'div',
        { class: 'page stack' },
        el(
          'header',
          { class: 'page-header' },
          el(
            'div',
            { class: 'page-header__titles' },
            el('h1', {}, APP.name),
            el(
              'p',
              { class: 'page-header__subtitle' },
              `${APP.description} Phase 1 of 10 — architecture and design system.`,
            ),
          ),
          el('div', { class: 'page-header__actions' }, themeButton),
        ),

        el(
          'section',
          { class: 'grid grid--summary', 'aria-label': 'Environment check' },
          statCard('Today', formatLedgerDate(today, { style: 'medium' }), today),
          statCard('Financial year', fy.label, `${fy.startDate} to ${fy.endDate}`),
          statCard('Sample amount', formatPaise(12500000), 'Stored as 12500000 paise'),
          statCard(
            'Base path',
            basePath,
            isProjectSite() ? 'Project site (subdirectory)' : 'Root deployment',
          ),
        ),

        el(
          'section',
          { class: 'stack stack--tight' },
          el('h2', {}, 'Deployment check'),
          el(
            'dl',
            { class: 'stack stack--tight u-text-sm' },
            defRow('Origin', window.location.origin),
            defRow('Asset URL resolves to', absoluteUrl('css/tokens.css')),
            defRow('Firebase project', firebaseConfig.projectId),
            defRow('Auth domain', firebaseConfig.authDomain),
            defRow('Version', APP.version),
          ),
          el(
            'p',
            { class: 'u-text-muted u-text-sm' },
            'If the asset URL above does not begin with your site address, the ',
            'base path is wrong and Phase 2 assets will 404.',
          ),
        ),
      ),
    ),
  );
}

/**
 * @param {string} label
 * @param {string} value
 * @param {string} detail
 */
function statCard(label, value, detail) {
  return el(
    'article',
    {
      class: 'card',
      style: {
        background: 'var(--surface-2)',
        border: '1px solid var(--border-subtle)',
        'border-radius': 'var(--radius-lg)',
        padding: 'var(--space-4)',
      },
    },
    el('p', { class: 'u-text-muted u-text-xs' }, label),
    el('p', { class: 'u-text-xl u-weight-semibold tnum' }, value),
    el('p', { class: 'u-text-muted u-text-xs u-truncate', title: detail }, detail),
  );
}

/** @param {string} term @param {string} value */
function defRow(term, value) {
  return el(
    'div',
    { class: 'row row--between u-gap-4' },
    el('dt', { class: 'u-text-muted' }, term),
    el('dd', { class: 'u-truncate', style: { margin: '0' } }, value),
  );
}

function start() {
  setTheme(getPreference(), { animate: false });
  watchSystemTheme();
  render();
  announce('PMExps loaded');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
