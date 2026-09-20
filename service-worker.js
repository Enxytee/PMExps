/**
 * PMExps — Service worker
 *
 * Makes the application shell available offline and survives a deploy without
 * serving a half-updated mixture of old and new files.
 *
 * Three rules govern what is cached:
 *
 * 1. **Only this app's own static files.** Firebase traffic is never cached.
 *    A cached Firestore response would be a stale balance presented as
 *    current, which is the single worst thing this application could do.
 *    Firestore has its own offline cache that understands what is pending;
 *    a service worker does not.
 *
 * 2. **Network first for HTML, cache first for everything else.** The HTML is
 *    what loads a new version, so it is fetched fresh whenever possible.
 *    Stylesheets and scripts are immutable per deploy and safe to serve from
 *    cache.
 *
 * 3. **One cache per version, and old ones are deleted on activate.** Mixing
 *    an old app.js with a new tokens.css produces layouts that look broken in
 *    ways nobody can reproduce.
 *
 * @module service-worker
 */

/**
 * Bumped by the deploy workflow, which rewrites this line with the commit
 * SHA. Any change to the string invalidates the whole cache.
 */
const CACHE_VERSION = 'pmexps-v9';

/** Scope-relative, so it works at /PMExps/ and at a custom domain root. */
const BASE = new URL('./', self.location).pathname;

/** The minimum needed to open the app and show something useful offline. */
const SHELL = [
  '',
  'index.html',
  'login.html',
  '404.html',
  'manifest.webmanifest',
  'css/tokens.css',
  'css/themes.css',
  'css/base.css',
  'css/layout.css',
  'css/components.css',
  'css/utilities.css',
  'css/responsive.css',
  'css/print.css',
  'js/app.js',
  'assets/images/favicon.svg',
  'assets/images/icon-192.png',
  'assets/images/icon-512.png',
].map((path) => BASE + path);

/** Hosts whose responses must never be cached. */
const NEVER_CACHE = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'firebasestorage.googleapis.com',
  'googleapis.com',
  'firebaseio.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // addAll fails the whole install if any single file 404s, which would
      // leave no worker at all. Files are added individually so one missing
      // asset degrades the offline experience instead of preventing it.
      await Promise.all(
        SHELL.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch (error) {
            console.warn('[PMExps SW] Could not cache', url, error);
          }
        }),
      );
      // Do NOT skipWaiting automatically. The page asks the user first, so a
      // bookkeeper mid-entry is never swapped onto a new version underneath
      // their unsaved form.
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** The page sends this after the user accepts an update. */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Anything Firebase, and anything cross-origin we did not put in the shell,
  // goes straight to the network untouched.
  if (NEVER_CACHE.some((host) => url.hostname.endsWith(host))) return;
  if (url.origin !== self.location.origin) return;

  // Navigations and HTML: network first, so a new deploy is picked up as soon
  // as there is a connection, with the cached shell as the fallback.
  const isNavigation =
    request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html');

  if (isNavigation) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE_VERSION);
          cache.put(request, response.clone());
          return response;
        } catch {
          const cached = await caches.match(request);
          return cached ?? (await caches.match(BASE + 'index.html')) ?? Response.error();
        }
      })(),
    );
    return;
  }

  // Everything else: cache first, refreshed in the background.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) {
        // Revalidate quietly so the next load has the newer file without
        // making this load wait for the network.
        fetch(request)
          .then(async (response) => {
            if (response.ok) {
              const cache = await caches.open(CACHE_VERSION);
              await cache.put(request, response);
            }
          })
          .catch(() => {});
        return cached;
      }

      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_VERSION);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        return Response.error();
      }
    })(),
  );
});
