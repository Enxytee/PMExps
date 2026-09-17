/**
 * PMExps — Router
 *
 * Hash-based routing (`#/ledger`, `#/entry/new?type=income`).
 *
 * Hash rather than History API, deliberately. GitHub Pages serves static
 * files with no server-side rewrite, so `/PMExps/ledger` would return a real
 * 404 on a hard refresh or a shared link. Everything after `#` never reaches
 * the server, so every route survives a refresh and every link is shareable.
 * `404.html` exists as a second line of defence for deep paths typed by hand.
 *
 * @module router
 */

/**
 * @typedef {object} Route
 * @property {string} path pattern, e.g. '/entry/:entryId'
 * @property {(context: RouteContext) => Promise<void>|void} render
 * @property {string} [title] document title suffix
 * @property {string[]} [requires] permissions the route needs
 */

/**
 * @typedef {object} RouteContext
 * @property {Record<string, string>} params path parameters
 * @property {URLSearchParams} query
 * @property {string} path
 */

/** @type {Route[]} */
let routes = [];

/** @type {(() => void)|null} */
let onNavigate = null;

/** @type {((context: RouteContext, route: Route) => boolean)|null} */
let guard = null;

/**
 * Compile '/entry/:entryId' into a matcher.
 * @param {string} pattern
 * @returns {{ regex: RegExp, keys: string[] }}
 */
function compile(pattern) {
  /** @type {string[]} */
  const keys = [];
  const source = pattern
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');

  return { regex: new RegExp(`^/${source}/?$`), keys };
}

/** Parse the current hash into a path and a query. */
function currentLocation() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, queryString = ''] = raw.split('?');
  return {
    path: path.startsWith('/') ? path : `/${path}`,
    query: new URLSearchParams(queryString),
  };
}

/**
 * Register routes. The first match wins, so order matters: put specific
 * patterns before parameterised ones.
 * @param {Route[]} definitions
 */
export function defineRoutes(definitions) {
  routes = definitions.map((route) => ({ ...route, ...compile(route.path) }));
}

/**
 * A function that may block navigation, used for permission checks.
 * Returning false means the route did not render and the guard has taken over.
 * @param {(context: RouteContext, route: Route) => boolean} fn
 */
export function setGuard(fn) {
  guard = fn;
}

/** @param {() => void} fn called after every successful navigation */
export function setOnNavigate(fn) {
  onNavigate = fn;
}

/**
 * Navigate programmatically.
 * @param {string} path e.g. '/entry/new?type=income'
 * @param {{ replace?: boolean }} [options]
 */
export function navigate(path, { replace = false } = {}) {
  const target = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (replace) {
    window.location.replace(target);
  } else {
    window.location.hash = target;
  }
}

/** Resolve and render the current hash. @returns {Promise<void>} */
export async function resolve() {
  const { path, query } = currentLocation();

  for (const route of routes) {
    const match = path.match(/** @type {any} */ (route).regex);
    if (!match) continue;

    /** @type {Record<string, string>} */
    const params = {};
    /** @type {string[]} */
    const keys = /** @type {any} */ (route).keys;
    keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1]);
    });

    const context = { params, query, path };

    if (guard && !guard(context, route)) return;

    if (route.title) document.title = `${route.title} — PMExps`;

    await route.render(context);
    onNavigate?.();

    // A route change is a new page as far as the reader is concerned, so
    // move focus to the heading. Without this a screen-reader user stays
    // parked on the link they clicked and hears nothing change.
    requestAnimationFrame(() => {
      const heading = document.querySelector('#main-content h1');
      if (heading instanceof HTMLElement) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
      window.scrollTo({ top: 0, behavior: 'auto' });
    });

    return;
  }

  // Nothing matched.
  const notFound = routes.find((route) => route.path === '/404');
  if (notFound) await notFound.render({ params: {}, query, path });
}

/** Start listening for hash changes. */
export function startRouter() {
  window.addEventListener('hashchange', () => {
    resolve().catch((error) => console.error('[PMExps] Route failed', error));
  });

  if (!window.location.hash) {
    window.location.replace('#/');
  }

  return resolve();
}

/** The current path, for marking active navigation items. @returns {string} */
export function currentPath() {
  return currentLocation().path;
}
