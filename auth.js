/**
 * PMExps — Authentication service
 *
 * Owns sign-in, sign-out, password reset, and the user profile document.
 *
 * One principle runs through this file: **being signed in grants nothing.**
 * A Firebase account proves who you are; it says nothing about which ledger
 * you may open. Workspace access is decided entirely by the member documents
 * checked in `services/workspaces.js` and enforced by security rules. So
 * nothing here ever returns a role or a permission.
 *
 * @module services/auth
 */

import { auth, db, authApi, firestore } from '../firebase/init.js';
import { LOCALE, THEME, DEFAULTS } from '../config/constants.js';

const {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut: firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
  reload,
} = authApi;

const { doc, getDoc, setDoc, updateDoc, serverTimestamp } = firestore;

/** Error carrying a stable code the UI can localise. */
export class AuthError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

/**
 * Turn a Firebase error code into a message that helps without leaking.
 *
 * Note that wrong-password and unknown-email both return the same text. That
 * is deliberate: distinguishing them tells an attacker which addresses are
 * registered, which is a free list of valid targets.
 *
 * @param {{ code?: string }} error
 * @returns {AuthError}
 */
function translateAuthError(error) {
  const code = error?.code ?? 'unknown';

  /** @type {Record<string, string>} */
  const messages = {
    'auth/invalid-credential': 'That email and password do not match.',
    'auth/wrong-password': 'That email and password do not match.',
    'auth/user-not-found': 'That email and password do not match.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/user-disabled': 'This account has been disabled. Contact your Super Admin.',
    'auth/too-many-requests':
      'Too many attempts. Wait a few minutes before trying again.',
    'auth/network-request-failed':
      'No connection. Check your network and try again.',
    'auth/email-already-in-use': 'An account already exists for that email.',
    'auth/weak-password': 'Choose a password of at least 8 characters.',
    'auth/requires-recent-login': 'Sign in again to make this change.',
    'auth/unauthorized-domain':
      'This site is not authorised for sign-in. Add it to Firebase authorized domains.',
  };

  return new AuthError(code, messages[code] ?? 'Sign-in failed. Try again.');
}

/**
 * Sign in with email and password.
 *
 * After Firebase accepts the credentials we still check the profile
 * document's `disabled` flag, because deactivating a person in the app should
 * take effect without an administrator having to touch the Firebase console.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<import('firebase/auth').User>}
 */
export async function signIn(email, password) {
  const cleanEmail = String(email).trim().toLowerCase();

  if (!cleanEmail || !password) {
    throw new AuthError('auth/missing-fields', 'Enter your email and password.');
  }

  let credential;
  try {
    credential = await signInWithEmailAndPassword(auth, cleanEmail, password);
  } catch (error) {
    throw translateAuthError(error);
  }

  const profile = await getUserProfile(credential.user.uid);
  if (profile?.disabled === true) {
    await firebaseSignOut(auth);
    throw new AuthError(
      'auth/user-disabled',
      'This account has been disabled. Contact your Super Admin.',
    );
  }

  if (!profile) {
    await createUserProfile(credential.user);
  }

  return credential.user;
}

/**
 * Create an account and its profile document.
 *
 * This does not grant access to any workspace. The new user lands on the
 * workspace screen with nothing, and must either create their own workspace
 * or be invited to one.
 *
 * @param {{ email: string, password: string, displayName: string }} input
 * @returns {Promise<import('firebase/auth').User>}
 */
export async function signUp({ email, password, displayName }) {
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanName = String(displayName ?? '').trim();

  if (cleanName.length < 2) {
    throw new AuthError('auth/invalid-name', 'Enter your name.');
  }
  if (String(password).length < 8) {
    throw new AuthError(
      'auth/weak-password',
      'Choose a password of at least 8 characters.',
    );
  }

  let credential;
  try {
    credential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
  } catch (error) {
    throw translateAuthError(error);
  }

  await updateProfile(credential.user, { displayName: cleanName });
  await createUserProfile(credential.user, cleanName);

  return credential.user;
}

/**
 * Send a password reset email.
 *
 * Resolves even when the address is unknown. Reporting "no such account"
 * would turn this form into an account-enumeration tool.
 *
 * @param {string} email
 * @returns {Promise<void>}
 */
export async function sendPasswordReset(email) {
  const cleanEmail = String(email).trim().toLowerCase();
  if (!cleanEmail) {
    throw new AuthError('auth/invalid-email', 'Enter your email address.');
  }

  try {
    await sendPasswordResetEmail(auth, cleanEmail);
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return;
    throw translateAuthError(error);
  }
}

/** Sign out. @returns {Promise<void>} */
export async function signOut() {
  await firebaseSignOut(auth);
}

/** The signed-in user, or null. @returns {import('firebase/auth').User|null} */
export function currentUser() {
  return auth.currentUser;
}

/**
 * Observe sign-in state. Fires immediately with the restored session, then on
 * every change.
 * @param {(user: import('firebase/auth').User|null) => void} callback
 * @returns {() => void} unsubscribe
 */
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

/**
 * Resolve once the initial session restore has completed. Routing waits on
 * this so a signed-in user never sees the login screen flash first.
 * @returns {Promise<import('firebase/auth').User|null>}
 */
export function waitForAuthReady() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

/* -------------------------------------------------------------------------
   User profile document
   ------------------------------------------------------------------------- */

/**
 * @param {string} uid
 * @returns {Promise<Record<string, unknown>|null>}
 */
export async function getUserProfile(uid) {
  const snapshot = await getDoc(doc(db, 'users', uid));
  return snapshot.exists() ? snapshot.data() : null;
}

/**
 * Create the profile document for a newly registered user.
 * Field values here must satisfy the `users` create rule exactly.
 * @param {import('firebase/auth').User} user
 * @param {string} [displayName]
 * @returns {Promise<void>}
 */
export async function createUserProfile(user, displayName) {
  await setDoc(doc(db, 'users', user.uid), {
    uid: user.uid,
    email: user.email,
    displayName: displayName ?? user.displayName ?? user.email?.split('@')[0] ?? 'User',
    phone: user.phoneNumber ?? null,
    photoUrl: null,
    locale: DEFAULTS.locale ?? LOCALE.EN,
    theme: DEFAULTS.theme ?? THEME.DARK,
    defaultWorkspaceId: null,
    disabled: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Update the preference fields a user owns. Anything not listed is ignored
 * rather than rejected, so a future field cannot accidentally be written.
 * @param {string} uid
 * @param {Record<string, unknown>} changes
 * @returns {Promise<void>}
 */
export async function updateUserProfile(uid, changes) {
  const allowed = ['displayName', 'phone', 'locale', 'theme', 'defaultWorkspaceId', 'photoUrl'];
  /** @type {Record<string, unknown>} */
  const payload = { updatedAt: serverTimestamp() };

  for (const key of allowed) {
    if (key in changes) payload[key] = changes[key];
  }

  await updateDoc(doc(db, 'users', uid), payload);
}

/** Refresh the cached user record, e.g. after an email verification. */
export async function refreshUser() {
  if (auth.currentUser) await reload(auth.currentUser);
  return auth.currentUser;
}
