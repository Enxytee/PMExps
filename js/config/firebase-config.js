/**
 * PMExps — Firebase web configuration
 *
 * These values are NOT secrets. A Firebase web config is shipped to every
 * browser that loads any Firebase web app; Google documents it as public.
 * The API key here identifies the project to Google's APIs — it does not
 * authorise anything on its own.
 *
 * What actually protects your data:
 *   1. Firestore Security Rules  (firestore.rules)
 *   2. Storage Security Rules    (storage.rules)
 *   3. Cloud Functions that re-validate auth, membership and role server-side
 *   4. Firebase Authentication authorized domains
 *
 * What must NEVER appear in this file or anywhere under /js:
 *   - A service-account JSON key
 *   - A Firebase Admin SDK private key
 *   - Any third-party API secret
 * Those belong in Cloud Functions secrets. See docs/security.md.
 *
 * Lock down the API key regardless: in Google Cloud Console →
 * APIs & Services → Credentials, add an HTTP-referrer restriction for your
 * GitHub Pages origin and localhost. Steps are in docs/setup.md §18.
 *
 * @module config/firebase-config
 */

/** @type {import('firebase/app').FirebaseOptions} */
export const firebaseConfig = {
  apiKey: 'AIzaSyDO7zSgTbV4UVnLBKWa0-LPPZCG2Tzu5sk',
  authDomain: 'pmexps.firebaseapp.com',
  projectId: 'pmexps',
  storageBucket: 'pmexps.firebasestorage.app',
  messagingSenderId: '750547080559',
  appId: '1:750547080559:web:9ab2763c5c989df47f849a',
  measurementId: 'G-K80V69DLYM',
};

/**
 * Analytics is configured but not initialised by default.
 *
 * Reasons: it pulls an extra SDK chunk on every load, it needs a
 * Content-Security-Policy entry for googletagmanager.com, and in several
 * jurisdictions it needs consent before it may run. Turn it on deliberately
 * in workspace settings once you have decided how to handle consent.
 */
export const analyticsEnabled = false;

/** Emulator ports — must match the `emulators` block in firebase.json. */
export const emulatorPorts = {
  auth: 9099,
  firestore: 8080,
  storage: 9199,
  functions: 5001,
  ui: 4000,
};

/**
 * Should this page talk to the Emulator Suite instead of production?
 *
 * True when served from localhost/127.0.0.1, or when `?emulator=1` is in the
 * URL, or when `localStorage.pmexps:useEmulator` is set. Deliberately never
 * true on the GitHub Pages origin, so a stray flag cannot point production
 * users at a local emulator.
 *
 * @returns {boolean}
 */
export function shouldUseEmulators() {
  if (typeof window === 'undefined') return false;

  const { hostname, search } = window.location;
  const isLocalHost =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.local');

  if (!isLocalHost) return false;

  if (new URLSearchParams(search).has('production')) return false;
  return true;
}

/**
 * The Cloud Functions region. Keep functions close to Firestore: both are in
 * asia-south1 (Mumbai) for an India-based ledger, which cuts round-trip time
 * on every confirm and voucher allocation.
 */
export const functionsRegion = 'asia-south1';
