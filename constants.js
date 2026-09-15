/**
 * PMExps — Domain constants
 *
 * Single source of truth for every enumerated value in the system. The same
 * strings are duplicated in firestore.rules and functions/src/constants.js
 * because rules cannot import modules; tests/unit/constants.test.js asserts
 * the three copies stay identical.
 *
 * @module config/constants
 */

/** Application identity. */
export const APP = Object.freeze({
  name: 'PMExps',
  shortName: 'PMExps',
  description: 'Daily income, expense and transfer ledger.',
  version: '0.1.0',
});

/* -------------------------------------------------------------------------
   Roles
   ------------------------------------------------------------------------- */

export const ROLE = Object.freeze({
  SUPER_ADMIN: 'superAdmin',
  ACCOUNTANT: 'accountant',
  VIEWER: 'viewer',
});

export const ROLES = Object.freeze([ROLE.SUPER_ADMIN, ROLE.ACCOUNTANT, ROLE.VIEWER]);

/** Ordering used to decide whether one role outranks another. */
export const ROLE_RANK = Object.freeze({
  [ROLE.VIEWER]: 1,
  [ROLE.ACCOUNTANT]: 2,
  [ROLE.SUPER_ADMIN]: 3,
});

/* -------------------------------------------------------------------------
   Permissions
   The client uses this matrix to hide controls a user cannot use. It is a
   convenience, never a security boundary — Firestore rules and Cloud
   Functions enforce the identical matrix independently.
   ------------------------------------------------------------------------- */

export const PERMISSION = Object.freeze({
  VIEW_DASHBOARD: 'viewDashboard',
  VIEW_TRANSACTIONS: 'viewTransactions',
  CREATE_DRAFT: 'createDraft',
  EDIT_OWN_DRAFT: 'editOwnDraft',
  EDIT_ANY_DRAFT: 'editAnyDraft',
  CONFIRM_ENTRY: 'confirmEntry',
  LOCK_DATES: 'lockDates',
  REQUEST_CORRECTION: 'requestCorrection',
  APPROVE_CORRECTION: 'approveCorrection',
  GENERATE_REPORTS: 'generateReports',
  SHARE_REPORTS: 'shareReports',
  MANAGE_ACCOUNTS: 'manageAccounts',
  MANAGE_CATEGORIES: 'manageCategories',
  MANAGE_MEMBERS: 'manageMembers',
  MANAGE_SETTINGS: 'manageSettings',
  VIEW_AUDIT_LOG: 'viewAuditLog',
  VIEW_OWN_AUDIT_LOG: 'viewOwnAuditLog',
});

/**
 * Capability matrix from the specification, §3.
 * Note that no role — including Super Admin — may permanently delete
 * financial history. That capability does not exist in this system.
 */
export const ROLE_PERMISSIONS = Object.freeze({
  [ROLE.SUPER_ADMIN]: Object.freeze([
    PERMISSION.VIEW_DASHBOARD,
    PERMISSION.VIEW_TRANSACTIONS,
    PERMISSION.CREATE_DRAFT,
    PERMISSION.EDIT_OWN_DRAFT,
    PERMISSION.EDIT_ANY_DRAFT,
    PERMISSION.CONFIRM_ENTRY,
    PERMISSION.LOCK_DATES,
    PERMISSION.REQUEST_CORRECTION,
    PERMISSION.APPROVE_CORRECTION,
    PERMISSION.GENERATE_REPORTS,
    PERMISSION.SHARE_REPORTS,
    PERMISSION.MANAGE_ACCOUNTS,
    PERMISSION.MANAGE_CATEGORIES,
    PERMISSION.MANAGE_MEMBERS,
    PERMISSION.MANAGE_SETTINGS,
    PERMISSION.VIEW_AUDIT_LOG,
  ]),
  [ROLE.ACCOUNTANT]: Object.freeze([
    PERMISSION.VIEW_DASHBOARD,
    PERMISSION.VIEW_TRANSACTIONS,
    PERMISSION.CREATE_DRAFT,
    PERMISSION.EDIT_OWN_DRAFT,
    PERMISSION.CONFIRM_ENTRY,
    PERMISSION.REQUEST_CORRECTION,
    PERMISSION.GENERATE_REPORTS,
    PERMISSION.SHARE_REPORTS,
    PERMISSION.VIEW_OWN_AUDIT_LOG,
  ]),
  [ROLE.VIEWER]: Object.freeze([
    PERMISSION.VIEW_DASHBOARD,
    PERMISSION.VIEW_TRANSACTIONS,
    PERMISSION.GENERATE_REPORTS,
    // SHARE_REPORTS is granted conditionally from workspace settings.
  ]),
});

/**
 * Does a role hold a permission?
 * @param {string} role
 * @param {string} permission
 * @returns {boolean}
 */
export function roleHas(role, permission) {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/* -------------------------------------------------------------------------
   Entries
   ------------------------------------------------------------------------- */

export const ENTRY_TYPE = Object.freeze({
  INCOME: 'income',
  EXPENSE: 'expense',
});

export const ENTRY_TYPES = Object.freeze([ENTRY_TYPE.INCOME, ENTRY_TYPE.EXPENSE]);

/**
 * Entry lifecycle. Legal transitions are declared below rather than left
 * implicit in UI code, so the rules file and the functions can assert them.
 */
export const ENTRY_STATUS = Object.freeze({
  DRAFT: 'draft',
  CONFIRMED: 'confirmed',
  LOCKED: 'locked',
  CORRECTED: 'corrected',
  REVERSED: 'reversed',
  VOID_DRAFT: 'voidDraft',
});

export const ENTRY_STATUSES = Object.freeze(Object.values(ENTRY_STATUS));

/**
 * Allowed status transitions, keyed by current status.
 * Anything absent from this map is rejected by rules and by functions.
 */
export const ENTRY_TRANSITIONS = Object.freeze({
  [ENTRY_STATUS.DRAFT]: Object.freeze([ENTRY_STATUS.CONFIRMED, ENTRY_STATUS.VOID_DRAFT]),
  [ENTRY_STATUS.CONFIRMED]: Object.freeze([ENTRY_STATUS.LOCKED, ENTRY_STATUS.CORRECTED]),
  [ENTRY_STATUS.LOCKED]: Object.freeze([ENTRY_STATUS.CORRECTED]),
  [ENTRY_STATUS.CORRECTED]: Object.freeze([]),
  [ENTRY_STATUS.REVERSED]: Object.freeze([]),
  [ENTRY_STATUS.VOID_DRAFT]: Object.freeze([ENTRY_STATUS.DRAFT]),
});

/** Statuses whose amounts count toward confirmed balances. */
export const BALANCE_AFFECTING_STATUSES = Object.freeze([
  ENTRY_STATUS.CONFIRMED,
  ENTRY_STATUS.LOCKED,
  ENTRY_STATUS.CORRECTED,
  ENTRY_STATUS.REVERSED,
]);

/** Statuses a client may edit directly. */
export const CLIENT_EDITABLE_STATUSES = Object.freeze([ENTRY_STATUS.DRAFT]);

/**
 * Is a status change legal?
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function canTransition(from, to) {
  return ENTRY_TRANSITIONS[from]?.includes(to) ?? false;
}

/* -------------------------------------------------------------------------
   Accounts and payment modes
   ------------------------------------------------------------------------- */

export const ACCOUNT_TYPE = Object.freeze({
  CASH: 'cash',
  BANK: 'bank',
  UPI_CARD: 'upiCard',
  PARTY: 'party',
});

export const ACCOUNT_TYPES = Object.freeze(Object.values(ACCOUNT_TYPE));

export const PAYMENT_MODE = Object.freeze({
  CASH: 'cash',
  BANK_TRANSFER: 'bankTransfer',
  UPI: 'upi',
  DEBIT_CARD: 'debitCard',
  CREDIT_CARD: 'creditCard',
  CHEQUE: 'cheque',
  OTHER: 'other',
});

export const PAYMENT_MODES = Object.freeze(Object.values(PAYMENT_MODE));

/* -------------------------------------------------------------------------
   Transfers and corrections
   ------------------------------------------------------------------------- */

export const TRANSFER_STATUS = Object.freeze({
  DRAFT: 'draft',
  CONFIRMED: 'confirmed',
  LOCKED: 'locked',
  REVERSED: 'reversed',
  VOID_DRAFT: 'voidDraft',
});

export const TRANSFER_LEG = Object.freeze({
  OUT: 'transferOut',
  IN: 'transferIn',
});

export const CORRECTION_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
});

/* -------------------------------------------------------------------------
   Voucher numbering
   ------------------------------------------------------------------------- */

export const VOUCHER_PREFIX = Object.freeze({
  [ENTRY_TYPE.INCOME]: 'INC',
  [ENTRY_TYPE.EXPENSE]: 'EXP',
  transfer: 'TRF',
  correction: 'COR',
});

/** Digits in the sequence portion: INC-2026-00001. */
export const VOUCHER_SEQUENCE_WIDTH = 5;

/** Placeholder shown on a draft before a real number is allocated. */
export const DRAFT_VOUCHER_LABEL = 'DRAFT';

/* -------------------------------------------------------------------------
   Attachments
   ------------------------------------------------------------------------- */

export const ATTACHMENT = Object.freeze({
  /** Enforced in the client, in Storage rules, and by the upload function. */
  allowedMimeTypes: Object.freeze([
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ]),
  allowedExtensions: Object.freeze(['.jpg', '.jpeg', '.png', '.webp', '.pdf']),
  maxBytes: 10 * 1024 * 1024, // 10 MB
  maxPerEntry: 5,
});

/* -------------------------------------------------------------------------
   Localisation and regional defaults
   ------------------------------------------------------------------------- */

export const LOCALE = Object.freeze({
  EN: 'en',
  GU: 'gu',
});

export const LOCALES = Object.freeze([LOCALE.EN, LOCALE.GU]);

export const DEFAULTS = Object.freeze({
  locale: LOCALE.EN,
  currency: 'INR',
  currencySymbol: '\u20B9',
  timeZone: 'Asia/Kolkata',
  theme: 'dark',
  pageSize: 50,
});

/* -------------------------------------------------------------------------
   Theme
   ------------------------------------------------------------------------- */

export const THEME = Object.freeze({
  DARK: 'dark',
  LIGHT: 'light',
  SYSTEM: 'system',
});

/** localStorage keys, namespaced so they cannot collide on a shared origin. */
export const STORAGE_KEY = Object.freeze({
  theme: 'pmexps:theme',
  locale: 'pmexps:locale',
  activeWorkspace: 'pmexps:activeWorkspace',
  sidebarCollapsed: 'pmexps:sidebarCollapsed',
  lastLedgerDate: 'pmexps:lastLedgerDate',
});

/* -------------------------------------------------------------------------
   Seed data — default categories and accounts created with a new workspace
   ------------------------------------------------------------------------- */

export const DEFAULT_INCOME_CATEGORIES = Object.freeze([
  { key: 'salesBusinessIncome', icon: 'trending-up', color: '#3bc98a', sortOrder: 10 },
  { key: 'salaryProfessionalIncome', icon: 'briefcase', color: '#5b8cff', sortOrder: 20 },
  { key: 'otherIncome', icon: 'circle-plus', color: '#4bb3d8', sortOrder: 30 },
]);

export const DEFAULT_EXPENSE_CATEGORIES = Object.freeze([
  { key: 'householdOfficeExpense', icon: 'house', color: '#e8a33d', sortOrder: 10 },
  { key: 'billsUtilities', icon: 'receipt', color: '#c77dff', sortOrder: 20 },
  { key: 'travelOtherExpense', icon: 'car-front', color: '#f2555a', sortOrder: 30 },
]);

export const DEFAULT_ACCOUNTS = Object.freeze([
  { key: 'cash', type: ACCOUNT_TYPE.CASH, icon: 'banknote', color: '#3bc98a', sortOrder: 10 },
  { key: 'bank', type: ACCOUNT_TYPE.BANK, icon: 'landmark', color: '#5b8cff', sortOrder: 20 },
  { key: 'upiCard', type: ACCOUNT_TYPE.UPI_CARD, icon: 'credit-card', color: '#c77dff', sortOrder: 30 },
  { key: 'party', type: ACCOUNT_TYPE.PARTY, icon: 'users', color: '#e8a33d', sortOrder: 40 },
]);

/* -------------------------------------------------------------------------
   Error codes returned by Cloud Functions
   Structured so the UI can map a code to a localised message without parsing
   an English string, and without the server leaking internal detail.
   ------------------------------------------------------------------------- */

export const ERROR_CODE = Object.freeze({
  UNAUTHENTICATED: 'unauthenticated',
  NOT_A_MEMBER: 'not-a-member',
  MEMBER_INACTIVE: 'member-inactive',
  INSUFFICIENT_ROLE: 'insufficient-role',
  WORKSPACE_MISMATCH: 'workspace-mismatch',
  VALIDATION_FAILED: 'validation-failed',
  DATE_LOCKED: 'date-locked',
  INVALID_TRANSITION: 'invalid-transition',
  ENTRY_IMMUTABLE: 'entry-immutable',
  SAME_ACCOUNT_TRANSFER: 'same-account-transfer',
  ACCOUNT_INACTIVE: 'account-inactive',
  CATEGORY_TYPE_MISMATCH: 'category-type-mismatch',
  DUPLICATE_REQUEST: 'duplicate-request',
  CONFLICT: 'conflict',
  NOT_FOUND: 'not-found',
  INTERNAL: 'internal',
});
