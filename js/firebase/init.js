/**
 * PMExps — Firebase initialisation
 *
 * One module owns the SDK. Everything else imports `auth` and `db` from here,
 * so there is exactly one app instance and one place where the emulator
 * decision is made.
 *
 * The SDK is loaded from Google's CDN at a pinned version. Pinned, not
 * `latest`, because an SDK that silently changes underneath a financial
 * application is a bug waiting to happen. When the service worker arrives in
 * Phase 8 these files get cached locally so the app still opens offline.
 *
 * @module firebase/init
 */

import {
  firebaseConfig,
  shouldUseEmulators,
  emulatorPorts,
} from '../config/firebase-config.js';

/** Pinned SDK version. Changing this is a deliberate, tested upgrade. */
export const FIREBASE_SDK_VERSION = '11.0.2';

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;

const { initializeApp } = await import(`${CDN}/firebase-app.js`);

const {
  getAuth,
  connectAuthEmulator,
  browserLocalPersistence,
  setPersistence,
} = await import(`${CDN}/firebase-auth.js`);

const {
  initializeFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentMultipleTabManager,
} = await import(`${CDN}/firebase-firestore.js`);

const { getStorage, connectStorageEmulator } = await import(
  `${CDN}/firebase-storage.js`
);

/** The one app instance. */
export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

/**
 * Firestore with persistent local cache.
 *
 * `persistentMultipleTabManager` matters here: a bookkeeper commonly has the
 * ledger open in two tabs, and the single-tab manager would throw in the
 * second one. The cache also gives us the offline draft behaviour of Phase 8
 * for free on reads.
 */
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

export const storage = getStorage(app);

/** True when this page is talking to the Emulator Suite. */
export const usingEmulators = shouldUseEmulators();

if (usingEmulators) {
  connectAuthEmulator(auth, `http://localhost:${emulatorPorts.auth}`, {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, 'localhost', emulatorPorts.firestore);
  connectStorageEmulator(storage, 'localhost', emulatorPorts.storage);
  console.info('[PMExps] Using Firebase emulators.');
}

/**
 * Keep the user signed in across browser restarts.
 *
 * A ledger is opened daily, often on a shared office machine, and forcing a
 * sign-in every session pushes people toward weak passwords. Local persistence
 * with an explicit Sign out is the better trade.
 */
await setPersistence(auth, browserLocalPersistence);

/**
 * Re-export the Firestore functions the rest of the app needs, so no other
 * module has to know the CDN URL or the pinned version.
 */
export const firestore = await import(`${CDN}/firebase-firestore.js`);
export const authApi = await import(`${CDN}/firebase-auth.js`);
export const storageApi = await import(`${CDN}/firebase-storage.js`);
