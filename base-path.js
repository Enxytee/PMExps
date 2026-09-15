/**
 * PMExps — Base path
 *
 * The app is served from three different roots and must behave identically at
 * all of them:
 *
 *   https://enxytee.github.io/PMExps/   GitHub Pages project site (production)
 *   http://localhost:5173/              local dev server
 *   https://ledger.example.com/         a custom domain, if ever added
 *
 * Everything in the HTML uses relative paths (`./css/tokens.css`), which
 * resolve correctly at any of those roots on their own. This module exists for
 * the three things relative paths cannot solve:
 *
 *   1. Service worker scope and registration URL
 *   2. The manifest `start_url` check and PWA install behaviour
 *   3. Building an absolute URL to share (a report link, an invitation)
 *
 * Nothing here is hard-coded to "/PMExps/". The base is derived at runtime, so
 * renaming the repository or moving to a custom domain needs no code change.
 *
 * @module utils/base-path
 */

/**
 * The path prefix the app is served under, always with a leading and trailing
 * slash. Root deployments return "/".
 *
 * Derived from this module's own URL rather than from `location.pathname`,
 * because `location.pathname` changes as the user navigates and would give a
 * different answer on `/PMExps/reports` than on `/PMExps/`. The module URL is
 * fixed at `{base}js/utils/base-path.js` no matter which route is open.
 *
 * @returns {string} e.g. "/PMExps/" or "/"
 */
export function getBasePath() {
  const moduleUrl = new URL(import.meta.url);
  const marker = '/js/utils/base-path.js';
  const path = moduleUrl.pathname;

  if (path.endsWith(marker)) {
    const base = path.slice(0, -marker.length + 1); // keep the trailing slash
    return base === '' ? '/' : base;
  }

  // Bundled or relocated: fall back to the directory two levels up.
  const segments = path.split('/').slice(0, -3);
  const base = `${segments.join('/')}/`;
  return base === '' ? '/' : base;
}

/** Cached, because it cannot change during a page's lifetime. */
const BASE = typeof window === 'undefined' ? '/' : getBasePath();

/**
 * Resolve an app-relative path against the base.
 *   assetUrl('assets/fonts/NotoSansGujarati.woff2')
 *     → "/PMExps/assets/fonts/NotoSansGujarati.woff2"
 *
 * Leading slashes on the input are stripped, so callers can pass either form.
 *
 * @param {string} path
 * @returns {string}
 */
export function assetUrl(path) {
  return `${BASE}${String(path).replace(/^\/+/, '')}`;
}

/**
 * Absolute URL for sharing — invitations, report links, WhatsApp messages.
 * @param {string} [path]
 * @returns {string}
 */
export function absoluteUrl(path = '') {
  return new URL(assetUrl(path), window.location.origin).href;
}

/**
 * The service worker's registration URL and scope.
 *
 * Scope must be the base path, not the origin root: a service worker
 * registered at `/PMExps/service-worker.js` cannot claim a scope of `/`, and
 * attempting it fails with a SecurityError. This is the single most common
 * reason a PWA works locally and silently fails on GitHub Pages.
 *
 * @returns {{ scriptUrl: string, scope: string }}
 */
export function serviceWorkerConfig() {
  return {
    scriptUrl: assetUrl('service-worker.js'),
    scope: BASE,
  };
}

/**
 * Is this a GitHub Pages project site (served from a subdirectory)?
 * Used to pick the right diagnostics in the offline panel.
 * @returns {boolean}
 */
export function isProjectSite() {
  return BASE !== '/';
}

export { BASE as basePath };
