/**
 * Security rules tests for Phase 4 — confirmation and voucher numbering.
 *
 * These are the tests that matter most in the whole project. They prove that
 * a client which has been tampered with cannot invent a voucher number, reuse
 * one, alter an amount while confirming, or confirm into a closed period.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, updateDoc, runTransaction, serverTimestamp,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

let testEnv;
const WS = 'ws1';
const OTHER_WS = 'ws2';

const ADMIN = 'admin-uid';
const ACCOUNTANT = 'acct-uid';
const VIEWER = 'viewer-uid';
const OUTSIDER = 'outsider-uid';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'pmexps-rules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => { await testEnv?.cleanup(); });

/** Seed data with rules disabled. */
beforeEach(async () => {
  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    for (const wid of [WS, OTHER_WS]) {
      await setDoc(doc(db, 'workspaces', wid), {
        workspaceId: wid, name: wid, type: 'business', currency: 'INR',
        ownerUid: ADMIN, memberCount: 1, status: 'active',
        createdBy: ADMIN, createdAt: new Date(), updatedAt: new Date(),
      });
      await setDoc(doc(db, 'workspaces', wid, 'settings', 'accounting'), {
        workspaceId: wid, lockDate: null,
      });
    }

    const members = [
      [ADMIN, 'superAdmin'], [ACCOUNTANT, 'accountant'], [VIEWER, 'viewer'],
    ];
    for (const [uid, role] of members) {
      await setDoc(doc(db, 'workspaces', WS, 'members', uid), {
        uid, workspaceId: WS, role, status: 'active',
        displayNameSnapshot: uid, emailSnapshot: `${uid}@t.test`,
        canShareReports: true, createdAt: new Date(), updatedAt: new Date(),
      });
    }

    // A draft ready to confirm, in each workspace.
    for (const wid of [WS, OTHER_WS]) {
      await setDoc(doc(db, 'workspaces', wid, 'ledgerEntries', 'e1'), {
        entryId: 'e1', workspaceId: wid, voucherNumber: null,
        ledgerDate: '2026-05-10', financialYear: '2026', type: 'income',
        categoryId: 'c1', categoryNameSnapshot: 'Sales',
        accountId: 'a1', accountNameSnapshot: 'Cash',
        description: 'Test entry', partyName: null, paymentMode: 'cash',
        amountPaise: 125000, referenceNumber: null, remarks: null,
        attachments: [], status: 'draft',
        enteredBy: ACCOUNTANT, enteredByName: 'acct',
        confirmedBy: null, confirmedAt: null, lockedBy: null, lockedAt: null,
        correctionOf: null, correctedBy: null, reversalOf: null,
        correctionRequestId: null, transferId: null, transferLeg: null,
        clientRequestId: 'req-1', isSynced: true,
        createdAt: new Date(), updatedAt: new Date(),
      });
    }
  });
});

/** Perform a correct confirmation transaction as a given user. */
function confirmTx(db, wid, entryId, overrides = {}) {
  return runTransaction(db, async (tx) => {
    const entryRef = doc(db, 'workspaces', wid, 'ledgerEntries', entryId);
    const counterRef = doc(db, 'workspaces', wid, 'voucherCounters', 'INC-2026');

    const entrySnap = await tx.get(entryRef);
    const counterSnap = await tx.get(counterRef);
    const next = (counterSnap.exists() ? counterSnap.data().lastNumber : 0) + 1;

    tx.set(counterRef, {
      counterId: 'INC-2026', workspaceId: wid, prefix: 'INC',
      financialYear: '2026', lastNumber: overrides.counterValue ?? next,
      updatedAt: serverTimestamp(),
    }, { merge: true });

    tx.update(entryRef, {
      status: 'confirmed',
      voucherNumber: overrides.voucherNumber ?? `INC-2026-${String(next).padStart(5, '0')}`,
      confirmedBy: overrides.confirmedBy ?? entrySnap.ref.firestore.app.options.__uid,
      confirmedByName: 'x',
      confirmedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(overrides.extra ?? {}),
    });
  });
}

/** Simpler helper: build the transaction with an explicit uid. */
function confirmAs(ctx, uid, wid, overrides = {}) {
  const db = ctx.firestore();
  return runTransaction(db, async (tx) => {
    const entryRef = doc(db, 'workspaces', wid, 'ledgerEntries', 'e1');
    const counterRef = doc(db, 'workspaces', wid, 'voucherCounters', 'INC-2026');

    const counterSnap = await tx.get(counterRef);
    await tx.get(entryRef);
    const next = (counterSnap.exists() ? counterSnap.data().lastNumber : 0) + 1;

    tx.set(counterRef, {
      counterId: 'INC-2026', workspaceId: wid, prefix: 'INC',
      financialYear: '2026',
      lastNumber: overrides.counterValue ?? next,
      updatedAt: serverTimestamp(),
    }, { merge: true });

    tx.update(entryRef, {
      status: 'confirmed',
      voucherNumber: overrides.voucherNumber ?? `INC-2026-${String(next).padStart(5, '0')}`,
      confirmedBy: overrides.confirmedBy ?? uid,
      confirmedByName: 'x',
      confirmedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(overrides.extra ?? {}),
    });
  });
}

describe('confirmation', () => {
  it('lets an accountant confirm a draft correctly', async () => {
    const ctx = testEnv.authenticatedContext(ACCOUNTANT);
    await assertSucceeds(confirmAs(ctx, ACCOUNTANT, WS));
  });

  it('lets a super admin confirm', async () => {
    const ctx = testEnv.authenticatedContext(ADMIN);
    await assertSucceeds(confirmAs(ctx, ADMIN, WS));
  });

  it('refuses a viewer', async () => {
    const ctx = testEnv.authenticatedContext(VIEWER);
    await assertFails(confirmAs(ctx, VIEWER, WS));
  });

  it('refuses someone who is not a member', async () => {
    const ctx = testEnv.authenticatedContext(OUTSIDER);
    await assertFails(confirmAs(ctx, OUTSIDER, WS));
  });

  it('refuses a voucher number that does not match the counter', async () => {
    const ctx = testEnv.authenticatedContext(ACCOUNTANT);
    await assertFails(
      confirmAs(ctx, ACCOUNTANT, WS, { voucherNumber: 'INC-2026-00099' }),
    );
  });

  it('refuses a counter that jumps by more than one', async () => {
    const ctx = testEnv.authenticatedContext(ACCOUNTANT);
    await assertFails(confirmAs(ctx, ACCOUNTANT, WS, { counterValue: 5 }));
  });

  it('refuses confirming in someone else name', async () => {
    const ctx = testEnv.authenticatedContext(ACCOUNTANT);
    await assertFails(confirmAs(ctx, ACCOUNTANT, WS, { confirmedBy: ADMIN }));
  });

  it('refuses changing the amount while confirming', async () => {
    const ctx = testEnv.authenticatedContext(ACCOUNTANT);
    await assertFails(
      confirmAs(ctx, ACCOUNTANT, WS, { extra: { amountPaise: 1 } }),
    );
  });

  it('refuses changing the date while confirming', async () => {
    const ctx = testEnv.authenticatedContext(ACCOUNTANT);
    await assertFails(
      confirmAs(ctx, ACCOUNTANT, WS, { extra: { ledgerDate: '2026-05-11' } }),
    );
  });

  it('gives the second entry the next number, not a duplicate', async () => {
    const ctx = testEnv.authenticatedContext(ACCOUNTANT);
    await assertSucceeds(confirmAs(ctx, ACCOUNTANT, WS));

    await testEnv.withSecurityRulesDisabled(async (admin) => {
      const db = admin.firestore();
      const first = await getDoc(doc(db, 'workspaces', WS, 'ledgerEntries', 'e1'));
      expect(first.data().voucherNumber).toBe('INC-2026-00001');

      await setDoc(doc(db, 'workspaces', WS, 'ledgerEntries', 'e2'), {
        ...first.data(), entryId: 'e2', status: 'draft',
        voucherNumber: null, confirmedBy: null, confirmedAt: null,
        clientRequestId: 'req-2',
      });
    });

    const db = ctx.firestore();
    await assertSucceeds(runTransaction(db, async (tx) => {
      const entryRef = doc(db, 'workspaces', WS, 'ledgerEntries', 'e2');
      const counterRef = doc(db, 'workspaces', WS, 'voucherCounters', 'INC-2026');
      const counterSnap = await tx.get(counterRef);
      await tx.get(entryRef);
      const next = counterSnap.data().lastNumber + 1;
      tx.set(counterRef, { lastNumber: next, updatedAt: serverTimestamp() }, { merge: true });
      tx.update(entryRef, {
        status: 'confirmed',
        voucherNumber: `INC-2026-${String(next).padStart(5, '0')}`,
        confirmedBy: ACCOUNTANT, confirmedByName: 'x',
        confirmedAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    }));

    await testEnv.withSecurityRulesDisabled(async (admin) => {
      const second = await getDoc(doc(admin.firestore(), 'workspaces', WS, 'ledgerEntries', 'e2'));
      expect(second.data().voucherNumber).toBe('INC-2026-00002');
    });
  });

  it('refuses confirming into a closed period', async () => {
    await testEnv.withSecurityRulesDisabled(async (admin) => {
      await updateDoc(doc(admin.firestore(), 'workspaces', WS, 'settings', 'accounting'), {
        lockDate: '2026-05-31',
      });
    });
    const ctx = testEnv.authenticatedContext(ACCOUNTANT);
    await assertFails(confirmAs(ctx, ACCOUNTANT, WS));
  });

  it('refuses confirming an entry in another workspace', async () => {
    const ctx = testEnv.authenticatedContext(ACCOUNTANT);
    await assertFails(confirmAs(ctx, ACCOUNTANT, OTHER_WS));
  });
});

describe('tenant isolation', () => {
  it('refuses reading another workspace entry', async () => {
    const db = testEnv.authenticatedContext(ACCOUNTANT).firestore();
    await assertFails(getDoc(doc(db, 'workspaces', OTHER_WS, 'ledgerEntries', 'e1')));
  });

  it('refuses reading another workspace at all', async () => {
    const db = testEnv.authenticatedContext(ACCOUNTANT).firestore();
    await assertFails(getDoc(doc(db, 'workspaces', OTHER_WS)));
  });
});

describe('privilege escalation', () => {
  it('refuses an accountant promoting themselves', async () => {
    const db = testEnv.authenticatedContext(ACCOUNTANT).firestore();
    await assertFails(
      updateDoc(doc(db, 'workspaces', WS, 'members', ACCOUNTANT), { role: 'superAdmin' }),
    );
  });

  it('refuses a super admin changing their own role', async () => {
    const db = testEnv.authenticatedContext(ADMIN).firestore();
    await assertFails(
      updateDoc(doc(db, 'workspaces', WS, 'members', ADMIN), { role: 'viewer' }),
    );
  });
});

describe('audit log', () => {
  it('allows a member to append a row in their own name', async () => {
    const db = testEnv.authenticatedContext(ACCOUNTANT).firestore();
    await assertSucceeds(setDoc(doc(db, 'workspaces', WS, 'auditLogs', 'a1'), {
      auditId: 'a1', workspaceId: WS, actorUid: ACCOUNTANT, actorName: 'acct',
      action: 'entry.confirm', entityType: 'ledgerEntry', entityId: 'e1',
      entityLabel: 'INC-2026-00001', beforeSummary: {}, afterSummary: {},
      reason: null, requestId: 'r1', sessionMeta: {},
      serverTimestamp: serverTimestamp(),
    }));
  });

  it('refuses writing an audit row in someone else name', async () => {
    const db = testEnv.authenticatedContext(ACCOUNTANT).firestore();
    await assertFails(setDoc(doc(db, 'workspaces', WS, 'auditLogs', 'a2'), {
      auditId: 'a2', workspaceId: WS, actorUid: ADMIN, actorName: 'admin',
      action: 'entry.confirm', entityType: 'ledgerEntry', entityId: 'e1',
      serverTimestamp: serverTimestamp(),
    }));
  });

  it('refuses editing an audit row', async () => {
    await testEnv.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), 'workspaces', WS, 'auditLogs', 'a3'), {
        auditId: 'a3', workspaceId: WS, actorUid: ACCOUNTANT, action: 'x',
        entityType: 'ledgerEntry', entityId: 'e1', serverTimestamp: new Date(),
      });
    });
    const db = testEnv.authenticatedContext(ADMIN).firestore();
    await assertFails(updateDoc(doc(db, 'workspaces', WS, 'auditLogs', 'a3'), { action: 'y' }));
  });
});
