/**
 * PMExps — Connectivity and app updates
 *
 * Owns three things a person actually notices: whether they are online,
 * whether a new version is waiting, and whether the app can be installed.
 *
 * On offline behaviour, this app takes a position worth stating plainly.
 * Firestore's own persistent cache already stores writes made offline and
 * sends them when the connection returns, so a draft written on a phone with
 * no signal is safe without any extra machinery. Building a second, parallel
 * store in IndexedDB would mean the same entry existed in two places, and two
 * copies of financial data eventually disagree.
 *
 * What cannot be done offline is anything that reads a counter and writes
 * based on it: confirming an entry, recording a transfer, closing a period,
 * approving a correction. Offline, the counter in the local cache may be
 * stale, and two devices would hand the same voucher number to two different
 * entries. Those operations are therefore refused with a clear reason rather
 * than queued.
 *
 * @module services/connectivity
 */

import { el, qs, announce } from '../utils/dom.js';
import { serviceWorkerConfig } from '../utils/base-path.js';

/** @type {Set<(online: boolean) => void>} */
const listeners = new Set();

let online = navigator.onLine;

/** @returns {boolean} */
export function isOnline() {
  return online;
}

/**
 * Subscribe to connectivity changes. Fires immediately with the current
 * state so a caller never has to check separately first.
 * @param {(online: boolean) => void} listener
 * @returns {() => void} unsubscribe
 */
export function onConnectivityChange(listener) {
  listeners.add(listener);
  listener(online);
  return () => listeners.delete(listener);
}

function setOnline(next) {
  if (online === next) return;
  online = next;
  renderBanner();
  for (const listener of listeners) listener(next);
  announce(next ? 'Back online' : 'You are offline', next ? 'polite' : 'assertive');
}

/**
 * Throw if an operation needs a live connection.
 *
 * Called at the start of confirm, transfer, lock and correction. The message
 * says what to do rather than only what went wrong, because "you are offline"
 * on its own leaves someone staring at a button.
 *
 * @param {string} action
 * @throws {Error}
 */
export function requireOnline(action) {
  if (online) return;
  throw new Error(
    `${action} needs a connection, because it takes the next voucher number from the server. Your drafts are saved and will sync on their own — try again once you are back online.`,
  );
}

/* -------------------------------------------------------------------------
   Offline banner
   ------------------------------------------------------------------------- */

function renderBanner() {
  let banner = qs('#offline-banner');

  if (online) {
    banner?.remove();
    return;
  }

  if (banner) return;

  banner = el(
    'div',
    { id: 'offline-banner', class: 'offline-banner', role: 'status' },
    el('span', { class: 'offline-banner__dot', 'aria-hidden': 'true' }),
    el(
      'span',
      {},
      'Offline. You can still write and edit drafts — they will sync when the connection returns. Confirming and transfers need to be online.',
    ),
  );

  document.body.appendChild(banner);
}

/* -------------------------------------------------------------------------
   Service worker
   ------------------------------------------------------------------------- */

/**
 * Register the service worker and watch for a new version.
 *
 * A waiting worker is NOT activated automatically. Someone halfway through
 * an entry form would lose it to a reload they did not ask for, so the app
 * offers the update and waits.
 *
 * @returns {Promise<void>}
 */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // The scope must be the app's base path. A worker at /PMExps/service-worker.js
  // cannot claim a scope of /, and attempting it fails with a SecurityError —
  // the usual reason a PWA works locally and silently does not on GitHub Pages.
  const { scriptUrl, scope } = serviceWorkerConfig();

  try {
    const registration = await navigator.serviceWorker.register(scriptUrl, { scope });

    if (registration.waiting) showUpdatePrompt(registration);

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;

      installing.addEventListener('statechange', () => {
        // A worker that installs while one is already controlling the page
        // is an update. Without a controller it is the first install, and
        // there is nothing to tell the user about.
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdatePrompt(registration);
        }
      });
    });

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  } catch (error) {
    // A failed registration must not stop the app loading. Offline support is
    // a convenience; the ledger is not.
    console.warn('[PMExps] Service worker registration failed', error);
  }
}

/** @param {ServiceWorkerRegistration} registration */
function showUpdatePrompt(registration) {
  if (qs('#update-prompt')) return;

  const prompt = el(
    'div',
    { id: 'update-prompt', class: 'update-prompt', role: 'status' },
    el('span', {}, 'A new version of PMExps is ready.'),
    el(
      'div',
      { class: 'row u-gap-2' },
      el(
        'button',
        {
          class: 'btn btn--ghost',
          type: 'button',
          onClick: () => prompt.remove(),
        },
        'Later',
      ),
      el(
        'button',
        {
          class: 'btn btn--primary',
          type: 'button',
          onClick: () => {
            registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
            prompt.remove();
          },
        },
        'Update now',
      ),
    ),
  );

  document.body.appendChild(prompt);
  announce('A new version of PMExps is ready');
}

/* -------------------------------------------------------------------------
   Install prompt
   ------------------------------------------------------------------------- */

/** @type {any} */
let deferredInstall = null;

/**
 * Capture the browser's install prompt so it can be offered from a button
 * rather than as an interruption.
 */
export function watchInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstall = event;
    const button = qs('#install-button');
    if (button) button.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    const button = qs('#install-button');
    if (button) button.hidden = true;
  });
}

/** @returns {boolean} */
export function canInstall() {
  return deferredInstall !== null;
}

/** @returns {Promise<boolean>} whether the person accepted */
export async function promptInstall() {
  if (!deferredInstall) return false;
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  deferredInstall = null;
  return outcome === 'accepted';
}

/** Start listening. Called once at boot. */
export function initConnectivity() {
  window.addEventListener('online', () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));
  renderBanner();
  watchInstallPrompt();
}
