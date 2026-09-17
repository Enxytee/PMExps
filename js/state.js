/**
 * PMExps — Application state
 *
 * A deliberately small store. It holds the things every screen needs — who is
 * signed in, which workspace is open, what role they hold, and the accounts
 * and categories for that workspace — and notifies listeners when any of it
 * changes.
 *
 * Accounts and categories are cached here rather than re-fetched per screen
 * because the entry form needs both on every open, and a bookkeeper switches
 * between the form and the ledger constantly. They are small, bounded lists;
 * ledger entries are not cached and are always read fresh.
 *
 * Nothing in this file is a security boundary. `state.role` decides which
 * buttons render. Firestore rules decide what actually happens.
 *
 * @module state
 */

import { loadMasterData } from './services/workspaces.js';

/**
 * @typedef {object} AppState
 * @property {import('firebase/auth').User|null} user
 * @property {string|null} workspaceId
 * @property {Record<string, any>|null} membership
 * @property {string|null} role
 * @property {any[]} accounts
 * @property {any[]} categories
 * @property {boolean} loadingMasterData
 */

/** @type {AppState} */
const state = {
  user: null,
  workspaceId: null,
  membership: null,
  role: null,
  accounts: [],
  categories: [],
  loadingMasterData: false,
};

/** @type {Set<(state: AppState) => void>} */
const listeners = new Set();

/** @returns {AppState} a frozen shallow copy, so no screen can mutate state */
export function getState() {
  return Object.freeze({ ...state });
}

/**
 * Subscribe to state changes.
 * @param {(state: AppState) => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  const snapshot = getState();
  for (const listener of listeners) listener(snapshot);
}

/**
 * Set the signed-in user and the workspace being opened.
 * @param {{user: any, workspaceId: string, membership: Record<string, any>}} context
 */
export function setContext({ user, workspaceId, membership }) {
  state.user = user;
  state.workspaceId = workspaceId;
  state.membership = membership;
  state.role = membership?.role ?? null;
  notify();
}

/** Clear everything on sign-out or workspace switch. */
export function clearContext() {
  state.user = null;
  state.workspaceId = null;
  state.membership = null;
  state.role = null;
  state.accounts = [];
  state.categories = [];
  notify();
}

/**
 * Load (or reload) accounts and categories for the active workspace.
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function refreshMasterData({ force = false } = {}) {
  if (!state.workspaceId) return;
  if (!force && state.accounts.length && state.categories.length) return;

  state.loadingMasterData = true;
  notify();

  try {
    const { accounts, categories } = await loadMasterData(state.workspaceId);
    state.accounts = accounts;
    state.categories = categories;
  } finally {
    state.loadingMasterData = false;
    notify();
  }
}

/* -------------------------------------------------------------------------
   Derived lookups
   These exist so no screen has to remember that a picker shows only active
   records while a historical row must still resolve a deactivated one.
   ------------------------------------------------------------------------- */

/** Accounts a user may choose in a form. @returns {any[]} */
export function selectableAccounts() {
  return state.accounts.filter((account) => account.isActive);
}

/**
 * Categories a user may choose, for one entry type.
 * @param {'income'|'expense'} type
 * @returns {any[]}
 */
export function selectableCategories(type) {
  return state.categories.filter(
    (category) => category.isActive && category.type === type,
  );
}

/**
 * Find an account by ID including deactivated ones, so an old ledger row
 * still renders its account name.
 * @param {string} accountId
 * @returns {any|null}
 */
export function findAccount(accountId) {
  return state.accounts.find((account) => account.accountId === accountId) ?? null;
}

/**
 * @param {string} categoryId
 * @returns {any|null}
 */
export function findCategory(categoryId) {
  return state.categories.find((category) => category.categoryId === categoryId) ?? null;
}
