/**
 * PMExps — Audit log reader
 *
 * Read-only by design. There is no write function here at all: audit rows are
 * appended by the operations that cause them, inside the same transaction, so
 * a row can never describe something that did not happen.
 *
 * @module repositories/audit
 */

import { db, firestore } from '../firebase/init.js';

const { collection, getDocs, query, where, orderBy, limit } = firestore;

/**
 * Recent audit rows.
 *
 * A Super Admin sees everything. An Accountant sees only their own actions —
 * the "Limited" cell in the capability matrix — which security rules enforce
 * independently, so this filter is convenience, not protection.
 *
 * @param {string} workspaceId
 * @param {{ actorUid?: string, action?: string, count?: number }} [options]
 * @returns {Promise<any[]>}
 */
export async function listAudit(workspaceId, options = {}) {
  const { actorUid, action, count = 100 } = options;
  const constraints = [];

  if (actorUid) constraints.push(where('actorUid', '==', actorUid));
  if (action) constraints.push(where('action', '==', action));
  constraints.push(orderBy('serverTimestamp', 'desc'), limit(count));

  const snapshot = await getDocs(
    query(collection(db, 'workspaces', workspaceId, 'auditLogs'), ...constraints),
  );
  return snapshot.docs.map((d) => d.data());
}

/**
 * Every recorded action for one entity, oldest first — the history of a
 * single voucher.
 * @param {string} workspaceId
 * @param {string} entityId
 * @returns {Promise<any[]>}
 */
export async function listAuditForEntity(workspaceId, entityId) {
  const snapshot = await getDocs(
    query(
      collection(db, 'workspaces', workspaceId, 'auditLogs'),
      where('entityId', '==', entityId),
      orderBy('serverTimestamp', 'asc'),
      limit(50),
    ),
  );
  return snapshot.docs.map((d) => d.data());
}
