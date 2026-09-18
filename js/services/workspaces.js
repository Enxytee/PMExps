/**
 * PMExps — Workspace service
 *
 * Membership, role resolution, active-workspace selection, and creating a
 * workspace from scratch.
 *
 * The role returned by `getMembership()` is used only to decide which
 * controls to show. It is never the thing that keeps data safe — security
 * rules re-derive the same role from the same member document on every single
 * read and write. If this file were replaced wholesale by a hostile version,
 * the ledger would still be protected.
 *
 * @module services/workspaces
 */

import { db, firestore } from '../firebase/init.js';
import { currentUser } from './auth.js';
import {
  ROLE,
  ROLE_PERMISSIONS,
  STORAGE_KEY,
  DEFAULTS,
  DEFAULT_ACCOUNTS,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  ENTRY_TYPE,
} from '../config/constants.js';
import { todayLedgerDate } from '../utils/dates.js';

const {
  doc,
  collection,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  updateDoc,
  serverTimestamp,
  collectionGroup,
} = firestore;

/** Error with a code the UI can map to a localised message. */
export class WorkspaceError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
  }
}

/* -------------------------------------------------------------------------
   Membership
   ------------------------------------------------------------------------- */

/**
 * Every workspace this user is an active member of.
 *
 * Uses a collection-group query over `members` filtered by uid, which the
 * rules permit because each matched document is inside a workspace the user
 * belongs to. A user who belongs to nothing gets an empty list, not an error.
 *
 * @returns {Promise<Array<{workspaceId: string, role: string, status: string,
 *   name: string, type: string, joinedAt: unknown}>>}
 */
export async function listMyWorkspaces() {
  const user = currentUser();
  if (!user) return [];

  const membershipQuery = query(
    collectionGroup(db, 'members'),
    where('uid', '==', user.uid),
    where('status', '==', 'active'),
  );

  const membershipSnapshot = await getDocs(membershipQuery);

  const results = await Promise.all(
    membershipSnapshot.docs.map(async (memberDoc) => {
      const membership = memberDoc.data();
      const workspaceRef = memberDoc.ref.parent.parent;
      if (!workspaceRef) return null;

      const workspaceSnapshot = await getDoc(workspaceRef);
      if (!workspaceSnapshot.exists()) return null;

      const workspace = workspaceSnapshot.data();
      return {
        workspaceId: workspaceRef.id,
        role: membership.role,
        status: membership.status,
        name: workspace.name,
        type: workspace.type,
        businessName: workspace.businessName ?? null,
        joinedAt: membership.joinedAt ?? null,
      };
    }),
  );

  return /** @type {any[]} */ (results.filter(Boolean)).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

/**
 * This user's membership in one workspace, or null if they have none.
 * @param {string} workspaceId
 * @returns {Promise<Record<string, unknown>|null>}
 */
export async function getMembership(workspaceId) {
  const user = currentUser();
  if (!user) return null;

  const snapshot = await getDoc(
    doc(db, 'workspaces', workspaceId, 'members', user.uid),
  );
  if (!snapshot.exists()) return null;

  const membership = snapshot.data();
  return membership.status === 'active' ? membership : null;
}

/**
 * Does this user hold a permission in this workspace?
 *
 * Presentation only. Hiding a button is a courtesy to the user, not a
 * security control — see the note at the top of this file.
 *
 * @param {string} role
 * @param {string} permission
 * @returns {boolean}
 */
export function can(role, permission) {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/* -------------------------------------------------------------------------
   Active workspace
   ------------------------------------------------------------------------- */

/** @returns {string|null} */
export function getActiveWorkspaceId() {
  try {
    return localStorage.getItem(STORAGE_KEY.activeWorkspace);
  } catch {
    return null;
  }
}

/** @param {string|null} workspaceId */
export function setActiveWorkspaceId(workspaceId) {
  try {
    if (workspaceId) localStorage.setItem(STORAGE_KEY.activeWorkspace, workspaceId);
    else localStorage.removeItem(STORAGE_KEY.activeWorkspace);
  } catch {
    /* Private browsing: the choice simply will not persist. */
  }
}

/**
 * The workspace to open, validated against live membership.
 *
 * A stored ID is never trusted on its own: the user may have been removed
 * since they last visited, so membership is re-checked before it is used.
 *
 * @returns {Promise<{workspaceId: string, membership: Record<string, unknown>}|null>}
 */
export async function resolveActiveWorkspace() {
  const storedId = getActiveWorkspaceId();

  if (storedId) {
    const membership = await getMembership(storedId);
    if (membership) return { workspaceId: storedId, membership };
    setActiveWorkspaceId(null);
  }

  const workspaces = await listMyWorkspaces();
  if (workspaces.length === 1) {
    const only = workspaces[0];
    const membership = await getMembership(only.workspaceId);
    if (membership) {
      setActiveWorkspaceId(only.workspaceId);
      return { workspaceId: only.workspaceId, membership };
    }
  }

  return null;
}

/* -------------------------------------------------------------------------
   Creating a workspace
   ------------------------------------------------------------------------- */

/**
 * Create a workspace, its owner membership, and the default accounts,
 * categories and settings.
 *
 * This runs as **two** batched commits, and the split is forced by how
 * security rules evaluate:
 *
 *   Batch 1 — workspace + owner member document.
 *     The workspace rule uses getAfter() to confirm the member document in
 *     this same commit makes the creator an active Super Admin. The member
 *     rule requires the workspace not to exist yet, which is true pre-commit.
 *
 *   Batch 2 — settings, accounts, categories.
 *     These rules call isSuperAdmin(), which does a get() on the member
 *     document. Inside batch 1 that get() sees the pre-commit state, where
 *     the member does not exist yet, and every write would be rejected. Once
 *     batch 1 has committed, the member exists and batch 2 is permitted.
 *
 * If batch 2 fails the workspace exists but is unseeded, so the caller is
 * told to retry seeding rather than being left with a silent half-setup.
 *
 * @param {{name: string, type?: string, businessName?: string|null,
 *   accentColor?: string}} input
 * @returns {Promise<string>} the new workspace ID
 */
export async function createWorkspace(input) {
  const user = currentUser();
  if (!user) {
    throw new WorkspaceError('unauthenticated', 'Sign in first.');
  }

  const name = String(input.name ?? '').trim();
  if (name.length < 1 || name.length > 100) {
    throw new WorkspaceError('invalid-name', 'Enter a workspace name.');
  }

  const type = input.type ?? 'business';
  if (!['personal', 'family', 'business'].includes(type)) {
    throw new WorkspaceError('invalid-type', 'Choose a workspace type.');
  }

  const workspaceRef = doc(collection(db, 'workspaces'));
  const workspaceId = workspaceRef.id;
  const displayName = user.displayName || user.email || 'Owner';

  // ---- Batch 1: workspace + owner membership --------------------------
  const first = writeBatch(db);

  first.set(workspaceRef, {
    workspaceId,
    name,
    type,
    businessName: input.businessName ?? null,
    address: null,
    contactPhone: null,
    contactEmail: user.email ?? null,
    logoPath: null,
    currency: 'INR',
    timeZone: DEFAULTS.timeZone,
    locale: DEFAULTS.locale,
    accentColor: input.accentColor ?? '#5b8cff',
    financialYearStartMonth: 4,
    ownerUid: user.uid,
    memberCount: 1,
    status: 'active',
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  first.set(doc(db, 'workspaces', workspaceId, 'members', user.uid), {
    uid: user.uid,
    workspaceId,
    role: ROLE.SUPER_ADMIN,
    status: 'active',
    displayNameSnapshot: displayName,
    emailSnapshot: user.email ?? '',
    canShareReports: true,
    invitedBy: null,
    invitedAt: null,
    joinedAt: serverTimestamp(),
    deactivatedBy: null,
    deactivatedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await first.commit();

  // ---- Batch 2: seed data ---------------------------------------------
  try {
    await seedWorkspace(workspaceId, user.uid);
  } catch (error) {
    throw new WorkspaceError(
      'seed-failed',
      'The workspace was created but its default accounts and categories could not be added. Open it and run setup again.',
    );
  }

  setActiveWorkspaceId(workspaceId);
  return workspaceId;
}

/**
 * Write the default settings, accounts and categories.
 * Separated so it can be re-run if it failed the first time.
 * @param {string} workspaceId
 * @param {string} uid
 * @returns {Promise<void>}
 */
export async function seedWorkspace(workspaceId, uid) {
  const batch = writeBatch(db);
  const today = todayLedgerDate();
  const base = ['workspaces', workspaceId];

  // Both names are seeded. A workspace created today therefore prints a fully
  // Gujarati ledger without anyone having to type translations first, and the
  // English name is still there for anyone who prefers it.
  const accountNames = {
    cash: { en: 'Cash', gu: 'રોકડ' },
    bank: { en: 'Bank', gu: 'બેંક' },
    upiCard: { en: 'UPI / Card', gu: 'UPI / કાર્ડ' },
    party: { en: 'Person / Party', gu: 'વ્યક્તિ / પાર્ટી' },
  };

  const categoryNames = {
    salesBusinessIncome: { en: 'Sales / Business Income', gu: 'વેચાણ / ધંધાની આવક' },
    salaryProfessionalIncome: { en: 'Salary / Professional Income', gu: 'પગાર / વ્યવસાયિક આવક' },
    otherIncome: { en: 'Other Income', gu: 'અન્ય આવક' },
    householdOfficeExpense: { en: 'Household / Office Expense', gu: 'ઘર / ઓફિસ ખર્ચ' },
    billsUtilities: { en: 'Bills & Utilities', gu: 'બિલ અને સુવિધા' },
    travelOtherExpense: { en: 'Travel / Other Expense', gu: 'મુસાફરી / અન્ય ખર્ચ' },
  };

  // Settings
  batch.set(doc(db, ...base, 'settings', 'accounting'), {
    workspaceId,
    lockDate: null,
    allowFutureDates: true,
    maxDaysAhead: 365,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, ...base, 'settings', 'pdf'), {
    workspaceId,
    showLogo: true,
    showSignatures: true,
    preparedByLabel: 'Prepared by',
    checkedByLabel: 'Checked by',
    authorisedByLabel: 'Authorised by',
    footerNote: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, ...base, 'settings', 'sharing'), {
    workspaceId,
    viewersMayShareReports: false,
    whatsappMessageTemplate: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Accounts
  for (const account of DEFAULT_ACCOUNTS) {
    const ref = doc(collection(db, ...base, 'accounts'));
    batch.set(ref, {
      accountId: ref.id,
      workspaceId,
      name: accountNames[account.key].en,
      nameGu: accountNames[account.key].gu,
      type: account.type,
      bankName: null,
      accountNumberMasked: null,
      ifsc: null,
      partyName: null,
      partyPhone: null,
      openingBalancePaise: 0,
      openingBalanceDate: today,
      currency: 'INR',
      icon: account.icon,
      color: account.color,
      sortOrder: account.sortOrder,
      isActive: true,
      isSystem: true,
      createdBy: uid,
      updatedBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // Categories
  const categories = [
    ...DEFAULT_INCOME_CATEGORIES.map((c) => ({ ...c, type: ENTRY_TYPE.INCOME })),
    ...DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c, type: ENTRY_TYPE.EXPENSE })),
  ];

  for (const category of categories) {
    const ref = doc(collection(db, ...base, 'categories'));
    batch.set(ref, {
      categoryId: ref.id,
      workspaceId,
      name: categoryNames[category.key].en,
      nameGu: categoryNames[category.key].gu,
      type: category.type,
      icon: category.icon,
      color: category.color,
      sortOrder: category.sortOrder,
      isActive: true,
      isSystem: true,
      entryCount: 0,
      createdBy: uid,
      updatedBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
}

/**
 * Accounts and categories for the active workspace, active ones first.
 * @param {string} workspaceId
 * @returns {Promise<{accounts: any[], categories: any[]}>}
 */
export async function loadMasterData(workspaceId) {
  const [accountsSnapshot, categoriesSnapshot] = await Promise.all([
    getDocs(collection(db, 'workspaces', workspaceId, 'accounts')),
    getDocs(collection(db, 'workspaces', workspaceId, 'categories')),
  ]);

  const bySortOrder = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0);

  return {
    accounts: accountsSnapshot.docs.map((d) => d.data()).sort(bySortOrder),
    categories: categoriesSnapshot.docs.map((d) => d.data()).sort(bySortOrder),
  };
}

/**
 * The details printed at the top of a ledger page.
 * @param {string} workspaceId
 * @returns {Promise<{businessName: string, address: string, contactPhone: string, contactEmail: string}>}
 */
export async function loadWorkspaceDetails(workspaceId) {
  const snapshot = await getDoc(doc(db, 'workspaces', workspaceId));
  const data = snapshot.exists() ? snapshot.data() : {};
  return {
    businessName: data.businessName ?? '',
    address: data.address ?? '',
    contactPhone: data.contactPhone ?? '',
    contactEmail: data.contactEmail ?? '',
  };
}

/**
 * Save them. Only descriptive fields are sent; the security rules reject any
 * attempt to touch ownership, member count or currency through this path, so
 * a bug here cannot become a privilege problem.
 *
 * @param {string} workspaceId
 * @param {Record<string, any>} details
 * @returns {Promise<void>}
 */
export async function saveWorkspaceDetails(workspaceId, details) {
  const current = await getDoc(doc(db, 'workspaces', workspaceId));
  const existing = current.exists() ? current.data() : {};

  await updateDoc(doc(db, 'workspaces', workspaceId), {
    // name is required by the rules to stay a valid 1-100 character string,
    // so it is carried through unchanged rather than left out.
    name: existing.name,
    businessName: nullIfEmpty(details.businessName),
    address: nullIfEmpty(details.address),
    contactPhone: nullIfEmpty(details.contactPhone),
    contactEmail: nullIfEmpty(details.contactEmail),
    updatedAt: serverTimestamp(),
  });
}

/** @param {unknown} value @returns {string|null} */
function nullIfEmpty(value) {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
}
