/**
 * PMExps — App shell
 *
 * The persistent frame: sidebar and top bar on desktop, compact header and
 * bottom navigation on mobile. Screens render into the main region; the frame
 * itself is built once and only its active state changes.
 *
 * @module components/shell
 */

import { el, qs, replaceChildren, toggleClass } from '../utils/dom.js';
import { navigate, currentPath } from '../router.js';
import { getState } from '../state.js';
import { signOut } from '../services/auth.js';
import { setActiveWorkspaceId } from '../services/workspaces.js';
import { getPreference, cycleTheme } from '../services/theme.js';
import { PERMISSION, ROLE } from '../config/constants.js';
import { announce } from '../utils/dom.js';

/**
 * Primary destinations. `permission` decides whether the item renders at all;
 * the route guard repeats the check, because hiding a link is not access
 * control.
 */
const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: 'layout-dashboard' },
  { path: '/ledger', label: 'Ledger', icon: 'book-open' },
  { path: '/entry/new', label: 'Add Entry', icon: 'plus', permission: PERMISSION.CREATE_DRAFT },
  { path: '/drafts', label: 'Drafts', icon: 'file-pen', permission: PERMISSION.CREATE_DRAFT },
  { path: '/transfer', label: 'Transfer', icon: 'arrow-left-right', permission: PERMISSION.CREATE_DRAFT },
  { path: '/reports', label: 'Reports', icon: 'chart-column' },
  { path: '/corrections', label: 'Corrections', icon: 'undo-2' },
  { path: '/settings', label: 'More', icon: 'settings' },
];

const ROLE_LABEL = {
  [ROLE.SUPER_ADMIN]: 'Super Admin',
  [ROLE.ACCOUNTANT]: 'Accountant',
  [ROLE.VIEWER]: 'Viewer',
};

let built = false;

/**
 * Icons are drawn inline as simple SVG paths rather than pulled from a
 * library, so the app has no icon dependency to load, version or cache. The
 * full Lucide set arrives in a later phase with proper self-hosting; these
 * placeholders keep the shell honest in the meantime.
 * @param {string} name
 * @returns {SVGElement}
 */
function icon(name) {
  const paths = {
    'layout-dashboard': 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
    'book-open': 'M12 7v14M3 18a9 9 0 0 1 9-3 9 9 0 0 1 9 3V5a9 9 0 0 0-9-3 9 9 0 0 0-9 3z',
    plus: 'M12 5v14M5 12h14',
    'file-pen': 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h7M14 2v6h6M21.4 13.6 16 19l-3 1 1-3 5.4-5.4a1.4 1.4 0 1 1 2 2z',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H7a1.7 1.7 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V7a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    menu: 'M3 6h18M3 12h18M3 18h18',
    'arrow-left-right': 'M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4',
    'chart-column': 'M3 3v18h18M7 16V10M12 16V6M17 16v-4',
    'undo-2': 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12H9',
    'scroll-text': 'M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4M19 17V5a2 2 0 0 0-2-2H8M15 8h-5M15 12h-5',
  };

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[name] ?? paths.plus);
  svg.appendChild(path);
  return svg;
}

/** @param {typeof NAV_ITEMS} items */
function visibleItems() {
  const { role } = getState();
  return NAV_ITEMS.filter((item) => {
    if (!item.permission) return true;
    // Viewers do not create entries, so the Add Entry and Drafts destinations
    // are absent rather than present-and-failing.
    return role === ROLE.SUPER_ADMIN || role === ROLE.ACCOUNTANT;
  });
}

/**
 * @param {{path: string, label: string, icon: string}} item
 * @param {string} className
 */
function navLink(item, className) {
  const isActive =
    item.path === '/' ? currentPath() === '/' : currentPath().startsWith(item.path);

  return el(
    'a',
    {
      class: `${className}${isActive ? ' is-active' : ''}`,
      href: `#${item.path}`,
      // aria-current is what tells a screen reader which item is the page
      // you are on. Colour alone does not communicate that.
      'aria-current': isActive ? 'page' : null,
    },
    icon(item.icon),
    el('span', {}, item.label),
  );
}

function themeToggle() {
  const button = el(
    'button',
    {
      class: 'btn btn--ghost',
      type: 'button',
      title: 'Change theme',
      onClick: () => {
        const next = cycleTheme();
        button.lastChild.textContent = next;
        announce(`Theme set to ${next}`);
      },
    },
    el('span', { class: 'u-text-muted u-text-xs' }, 'Theme: '),
    el('span', {}, getPreference()),
  );
  return button;
}

async function handleSignOut() {
  setActiveWorkspaceId(null);
  await signOut();
  window.location.replace('./login.html');
}

/** Build the persistent frame once. */
export function buildShell() {
  const app = qs('#app');
  if (!app) return;

  const { membership, workspaceName } = getState();

  const sidebar = el(
    'aside',
    { class: 'app-sidebar', id: 'app-sidebar', 'aria-label': 'Main navigation' },
    el(
      'div',
      { class: 'sidebar__brand' },
      el('img', { src: './assets/images/icon-192.png', alt: '', width: 28, height: 28 }),
      el('span', { class: 'u-weight-semibold' }, 'PMExps'),
    ),
    el(
      'nav',
      { class: 'sidebar__nav' },
      ...visibleItems().map((item) => navLink(item, 'nav-item')),
    ),
    el(
      'div',
      { class: 'sidebar__footer u-mt-auto' },
      el(
        'p',
        { class: 'u-text-xs u-text-muted' },
        ROLE_LABEL[membership?.role] ?? '',
      ),
      el(
        'button',
        { class: 'btn btn--ghost', type: 'button', onClick: handleSignOut },
        'Sign out',
      ),
    ),
  );

  const topbar = el(
    'header',
    { class: 'app-topbar' },
    el(
      'button',
      {
        class: 'btn btn--ghost',
        type: 'button',
        'aria-label': 'Toggle navigation',
        onClick: () => {
          const shell = qs('#app');
          const open = shell?.dataset.drawer === 'open';
          if (shell) shell.dataset.drawer = open ? 'closed' : 'open';
        },
      },
      icon('menu'),
    ),
    el('div', { class: 'u-flex-1' }),
    themeToggle(),
  );

  const mobileHeader = el(
    'header',
    { class: 'app-mobile-header' },
    el(
      'button',
      {
        class: 'btn btn--ghost',
        type: 'button',
        'aria-label': 'Open navigation',
        'aria-controls': 'app-sidebar',
        onClick: () => {
          const shell = qs('#app');
          if (shell) shell.dataset.drawer = shell.dataset.drawer === 'open' ? 'closed' : 'open';
        },
      },
      icon('menu'),
    ),
    el('span', { class: 'u-weight-semibold u-flex-1' }, 'PMExps'),
    themeToggle(),
  );

  const bottomNav = el(
    'nav',
    { class: 'app-bottomnav', 'aria-label': 'Primary' },
    ...visibleItems().map((item) => navLink(item, 'bottomnav__item')),
  );

  const main = el('main', { id: 'main-content', class: 'app-main', tabindex: '-1' });

  replaceChildren(app, sidebar, mobileHeader, topbar, main, bottomNav);
  app.dataset.drawer = 'closed';
  built = true;
}

/** Re-mark the active navigation item after a route change. */
export function refreshNavState() {
  if (!built) return;
  const path = currentPath();

  for (const link of document.querySelectorAll('.nav-item, .bottomnav__item')) {
    const href = link.getAttribute('href')?.replace('#', '') ?? '';
    const isActive = href === '/' ? path === '/' : path.startsWith(href);
    toggleClass(link, 'is-active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  // Close the mobile drawer on navigation; leaving it open over the new page
  // is the classic mobile-nav annoyance.
  const app = qs('#app');
  if (app) app.dataset.drawer = 'closed';
}

/**
 * Render a screen into the main region.
 * @param {...(Node|string)} children
 */
export function renderPage(...children) {
  if (!built) buildShell();
  const main = qs('#main-content');
  if (!main) return;
  replaceChildren(main, el('div', { class: 'page stack stack--loose' }, ...children));
}

/**
 * Standard page header.
 * @param {{title: string, subtitle?: string, actions?: Array<Node|false|null>}} options
 * @returns {HTMLElement}
 */
export function pageHeader({ title, subtitle, actions = [] }) {
  return el(
    'header',
    { class: 'page-header' },
    el(
      'div',
      { class: 'page-header__titles' },
      el('h1', {}, title),
      subtitle && el('p', { class: 'page-header__subtitle' }, subtitle),
    ),
    el('div', { class: 'page-header__actions' }, ...actions.filter(Boolean)),
  );
}

/** @param {string} path */
export function goTo(path) {
  navigate(path);
}
