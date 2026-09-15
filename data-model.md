# PMExps — Firestore data model

Project: `pmexps` · Region: `asia-south1` · Currency: INR stored as integer paise

---

## Design decisions that shape everything below

**1. Workspace-scoped subcollections, not a flat collection with a filter.**
Every business record lives under `workspaces/{workspaceId}/…`. Tenant isolation
then falls out of the document path itself, so a security rule can reject a
cross-tenant read with a path match instead of trusting a `where` clause the
client supplied. A flat `ledgerEntries` collection filtered by `workspaceId`
would require every rule and every query to be correct forever; this does not.

**2. `workspaceId` is *also* stored inside each document.**
Redundant with the path, deliberately. Collection-group queries (used by the
audit report and the rebuild script) lose path context, and Cloud Functions
validate the field against the path on every write. If the two disagree, the
write is rejected.

**3. Money is an integer field, never a float, never a string.**
Field name is always `amountPaise` (or `…Paise`) so a reviewer can see the unit
at the call site. Rules assert `is int`. See `js/utils/money.js`.

**4. Snapshots are stored alongside references.**
`categoryId` + `categoryNameSnapshot`, `accountId` + `accountNameSnapshot`. A
category renamed in 2027 must not silently rewrite a voucher printed in 2026.
The ID keeps the relationship live for filtering; the snapshot keeps the
historical document truthful.

**5. Confirmed financial documents are not client-writable at all.**
Rules allow client `create`/`update` only on `status == "draft"`. Every
balance-affecting transition goes through a callable Cloud Function that runs
in a Firestore transaction with an idempotency key.

**6. Nothing financial is ever deleted.**
There is no `delete` permission on `ledgerEntries`, `transfers`, or
`auditLogs` for any role. Drafts are retired by moving to `status:
"voidDraft"`. Master data is deactivated, not removed.

---

## Collection map

```
users/{uid}
userWorkspaceIndex/{uid}
workspaces/{workspaceId}
  members/{uid}
  accounts/{accountId}
  categories/{categoryId}
  ledgerEntries/{entryId}
  transfers/{transferId}
  correctionRequests/{requestId}
  auditLogs/{auditId}
  dailySummaries/{YYYY-MM-DD}
  accountBalances/{accountId}
  voucherCounters/{counterId}
  settings/{settingsDoc}
  notifications/{notificationId}
  idempotency/{requestId}
  lockDates/{lockId}
```

---

## `users/{uid}`

One document per Firebase Auth user. Profile only — **never** roles.

| Field | Type | Required | Notes |
|---|---|---|---|
| `uid` | string | yes | Equals document ID and `request.auth.uid` |
| `email` | string | yes | Mirrored from Auth; lowercase |
| `displayName` | string | yes | 1–80 chars |
| `phone` | string \| null | no | E.164 |
| `photoUrl` | string \| null | no | Storage path, not a public URL |
| `locale` | `'en' \| 'gu'` | yes | Default `en` |
| `theme` | `'dark' \| 'light' \| 'system'` | yes | Default `dark` |
| `defaultWorkspaceId` | string \| null | no | Restored on next sign-in |
| `disabled` | boolean | yes | Set by Super Admin flow; blocks all access |
| `createdAt` / `updatedAt` | timestamp | yes | Server timestamps |

**Document ID:** the Auth UID.
**Client writes:** own document only, and only `displayName`, `phone`, `locale`,
`theme`, `defaultWorkspaceId`, `photoUrl`. `disabled` and `email` are
function-only.
**Why no role field here:** a user's capability is per-workspace. Putting a role
on the user document would make privilege escalation a single-field write.

---

## `userWorkspaceIndex/{uid}`

A denormalised list letting the workspace-picker screen load without a
collection-group query across every workspace's `members`.

| Field | Type | Notes |
|---|---|---|
| `uid` | string | Document ID |
| `workspaces` | map<workspaceId, {name, role, status, joinedAt, logoPath}> | ≤ 50 entries |
| `updatedAt` | timestamp | Server |

**Client writes:** none. Maintained by `onMemberWritten` trigger.
**Read:** own document only.
**Consistency note:** this is a cache. The authoritative membership record is
`workspaces/{id}/members/{uid}`, and every security rule reads *that*, never
this. A stale index can show a workspace the user cannot open — acceptable; the
reverse (granting access) is impossible because rules never consult it.

---

## `workspaces/{workspaceId}`

| Field | Type | Required | Notes |
|---|---|---|---|
| `workspaceId` | string | yes | Equals doc ID |
| `name` | string | yes | 1–100 chars |
| `type` | `'personal' \| 'family' \| 'business'` | yes | Affects defaults only |
| `businessName` | string \| null | no | Printed on PDFs |
| `address` | string \| null | no | Multi-line, ≤ 300 chars |
| `contactPhone` / `contactEmail` | string \| null | no | PDF header |
| `logoPath` | string \| null | no | Storage path |
| `currency` | string | yes | `'INR'` — single-currency by design (spec §41) |
| `timeZone` | string | yes | Default `Asia/Kolkata` |
| `locale` | `'en' \| 'gu'` | yes | Workspace default |
| `accentColor` | string | yes | Hex; overrides `--accent` |
| `financialYearStartMonth` | int | yes | `4` (April) |
| `ownerUid` | string | yes | Cannot be removed from members |
| `memberCount` | int | yes | Maintained by trigger |
| `status` | `'active' \| 'suspended'` | yes | |
| `createdAt` / `updatedAt` / `createdBy` | — | yes | Server |

**Document ID:** auto-generated 20-char Firestore ID.
**Client writes:** Super Admin may update descriptive fields. `ownerUid`,
`memberCount`, `status` are function-only.

---

## `workspaces/{workspaceId}/members/{uid}`

The authoritative permission record. Every rule in the system reads this.

| Field | Type | Required | Notes |
|---|---|---|---|
| `uid` | string | yes | Doc ID |
| `workspaceId` | string | yes | Must match path |
| `role` | `'superAdmin' \| 'accountant' \| 'viewer'` | yes | |
| `status` | `'active' \| 'invited' \| 'deactivated'` | yes | Only `active` grants access |
| `displayNameSnapshot` / `emailSnapshot` | string | yes | So member lists render without N user reads |
| `canShareReports` | boolean | yes | Viewer-only toggle (spec §3) |
| `invitedBy` / `invitedAt` | — | no | |
| `joinedAt` | timestamp | no | Null until invitation accepted |
| `deactivatedBy` / `deactivatedAt` | — | no | |
| `createdAt` / `updatedAt` | timestamp | yes | Server |

**Document ID:** the member's Auth UID. Makes the membership lookup a single
`get()` at a known path — essential, because rules call it on nearly every
request and a query would not be permitted there.

**Client writes: none, ever.** All membership changes go through the
`manageMember` callable. This is what makes self-promotion structurally
impossible rather than merely disallowed: there is no client write path to a
role field at all.

---

## `workspaces/{workspaceId}/accounts/{accountId}`

| Field | Type | Required | Notes |
|---|---|---|---|
| `accountId` / `workspaceId` | string | yes | |
| `name` | string | yes | 1–60, unique per workspace (enforced in function) |
| `type` | `ACCOUNT_TYPE` | yes | `cash \| bank \| upiCard \| party` |
| `bankName` / `accountNumberMasked` / `ifsc` | string \| null | no | Store **masked** only: `••••3421` |
| `partyName` / `partyPhone` | string \| null | no | For `party` accounts |
| `openingBalancePaise` | int | yes | May be negative (party can owe) |
| `openingBalanceDate` | string | yes | `YYYY-MM-DD` |
| `currency` | string | yes | `'INR'` |
| `icon` | string | yes | Lucide icon name |
| `color` | string | yes | Hex |
| `sortOrder` | int | yes | |
| `isActive` | boolean | yes | Deactivate, never delete |
| `isSystem` | boolean | yes | Seeded defaults; cannot be deactivated to zero |
| `createdAt` / `updatedAt` / `createdBy` / `updatedBy` | — | yes | |

**Never deleted.** Historical entries keep `accountId` pointing at a
deactivated account and still resolve. The account picker filters on
`isActive == true`; the ledger table does not.

---

## `workspaces/{workspaceId}/categories/{categoryId}`

| Field | Type | Required | Notes |
|---|---|---|---|
| `categoryId` / `workspaceId` | string | yes | |
| `name` | string | yes | 1–60 |
| `nameGu` | string \| null | no | Gujarati label |
| `type` | `'income' \| 'expense'` | yes | **Immutable after first use** |
| `icon` / `color` | string | yes | |
| `sortOrder` | int | yes | Reorder writes a batch of these |
| `isActive` | boolean | yes | |
| `isSystem` | boolean | yes | The six seeded categories |
| `entryCount` | int | yes | Maintained by trigger; blocks deletion when > 0 |
| `createdAt` / `updatedAt` / `createdBy` / `updatedBy` | — | yes | |

**Why `type` is immutable once used:** flipping an income category to expense
would invert the sign of every historical entry referencing it. The function
rejects the change when `entryCount > 0`.

---

## `workspaces/{workspaceId}/ledgerEntries/{entryId}` — the core collection

| Field | Type | Required | Notes |
|---|---|---|---|
| `entryId` / `workspaceId` | string | yes | |
| `voucherNumber` | string \| null | yes | `null` while draft; `INC-2026-00001` once confirmed |
| `ledgerDate` | string | yes | `YYYY-MM-DD`, workspace timezone |
| `financialYear` | string | yes | `'2026'` — denormalised for counter + report queries |
| `type` | `'income' \| 'expense'` | yes | Exactly one. Never both |
| `categoryId` | string | yes | Must exist in this workspace |
| `categoryNameSnapshot` | string | yes | Frozen at confirmation |
| `accountId` | string | yes | Must exist in this workspace |
| `accountNameSnapshot` | string | yes | Frozen at confirmation |
| `description` | string | yes | 1–200 |
| `partyName` | string \| null | no | ≤ 100 |
| `paymentMode` | `PAYMENT_MODE` | yes | |
| `amountPaise` | int | yes | `> 0`. Direction comes from `type`, never from sign |
| `referenceNumber` | string \| null | no | Cheque / invoice / UTR, ≤ 50 |
| `remarks` | string \| null | no | ≤ 500 |
| `attachments` | array<AttachmentMeta> | yes | ≤ 5; see below |
| `status` | `ENTRY_STATUS` | yes | |
| `enteredBy` / `enteredByName` | string | yes | |
| `confirmedBy` / `confirmedByName` / `confirmedAt` | — | no | Set by function only |
| `lockedBy` / `lockedAt` | — | no | Function only |
| `correctionOf` | string \| null | no | This entry replaces that one |
| `correctedBy` | string \| null | no | That entry replaces this one |
| `reversalOf` | string \| null | no | This entry reverses that one |
| `correctionRequestId` | string \| null | no | |
| `transferId` | string \| null | no | Set when this entry is a transfer leg |
| `transferLeg` | `'transferOut' \| 'transferIn'` \| null | no | |
| `clientRequestId` | string | yes | UUID v4; idempotency key |
| `isSynced` | boolean | yes | False for drafts created offline |
| `createdAt` / `updatedAt` | timestamp | yes | Server |

### AttachmentMeta

```js
{
  attachmentId: string,       // UUID
  storagePath: string,        // workspaces/{wid}/entries/{entryId}/{attachmentId}.pdf
  fileName: string,           // original, sanitised
  mimeType: string,           // one of ATTACHMENT.allowedMimeTypes
  sizeBytes: number,
  uploadedBy: string,
  uploadedAt: timestamp,
}
```

Attachment *bytes* live in Storage; only this metadata is in Firestore. No
download URL is stored — the client requests a short-lived URL at view time so
a leaked document cannot leak a permanent public link.

### Validation enforced in rules **and** in functions

- `amountPaise is int && amountPaise > 0 && amountPaise <= 99999999999`
- `type in ['income','expense']`
- category's `type` equals entry's `type`
- `accountId` and `categoryId` resolve inside **this** workspace
- `ledgerDate` matches `^\d{4}-\d{2}-\d{2}$`
- `ledgerDate > workspace lockDate` for any new or edited entry
- client writes permitted only when `status == 'draft'` before *and* after
- `voucherNumber`, `confirmedBy`, `confirmedAt`, `lockedBy`, `lockedAt`,
  `correctedBy`, `transferId` are unwritable by clients in all cases

---

## `workspaces/{workspaceId}/transfers/{transferId}`

A transfer is one `transfers` document **plus two linked `ledgerEntries`**, all
written in a single transaction. The parent document is the audit-friendly
record; the two legs are what the balance calculation actually reads, so a
transfer can never be half-counted.

| Field | Type | Notes |
|---|---|---|
| `transferId` / `workspaceId` | string | |
| `voucherNumber` | string \| null | `TRF-2026-00001` |
| `ledgerDate` / `financialYear` | string | |
| `fromAccountId` / `fromAccountNameSnapshot` | string | |
| `toAccountId` / `toAccountNameSnapshot` | string | **must differ** from source |
| `amountPaise` | int | `> 0` |
| `referenceNumber` / `description` / `remarks` | string | |
| `status` | `TRANSFER_STATUS` | |
| `outEntryId` / `inEntryId` | string \| null | The two legs |
| `reversalOfTransferId` / `reversedByTransferId` | string \| null | |
| `clientRequestId` | string | Idempotency |
| audit fields | — | `createdBy`, `confirmedBy`, `confirmedAt`, … |

**Invariant, asserted in the confirm function and in tests:** the out-leg and
in-leg carry identical `amountPaise`, identical `ledgerDate`, identical
`transferId`, and opposite `transferLeg`. Both are excluded from income and
expense totals by `transferId != null`.

---

## `workspaces/{workspaceId}/correctionRequests/{requestId}`

| Field | Type | Notes |
|---|---|---|
| `requestId` / `workspaceId` | string | |
| `targetType` | `'ledgerEntry' \| 'transfer'` | |
| `targetId` | string | |
| `targetVoucherNumber` | string | Snapshot for the approval screen |
| `originalSummary` | map | Frozen copy of the material fields |
| `proposedSummary` | map | What the requester wants instead |
| `reason` | string | **Mandatory**, 10–500 chars |
| `status` | `CORRECTION_STATUS` | `pending \| approved \| rejected \| cancelled` |
| `requestedBy` / `requestedByName` / `requestedAt` | — | |
| `reviewedBy` / `reviewedByName` / `reviewedAt` / `reviewNote` | — | |
| `reversalEntryId` / `replacementEntryId` | string \| null | Written on approval |
| `clientRequestId` | string | |

**Client writes:** an Accountant or Super Admin may `create` with
`status: 'pending'`, and may `update` only to `cancelled`, only their own,
only while pending. Approval is function-only.

---

## `workspaces/{workspaceId}/auditLogs/{auditId}`

Append-only. **No client write of any kind — not create, not update, not
delete.** Every document is written by a Cloud Function.

| Field | Type | Notes |
|---|---|---|
| `auditId` / `workspaceId` | string | |
| `actorUid` / `actorName` / `actorRole` | string | Role at time of action |
| `action` | string | `entry.confirm`, `member.roleChange`, `date.lock`, … |
| `entityType` / `entityId` | string | |
| `entityLabel` | string | Voucher number or account name, for reading |
| `beforeSummary` / `afterSummary` | map \| null | Material fields only, never whole docs |
| `reason` | string \| null | Required for corrections and lock changes |
| `requestId` | string | Correlates with the idempotency key |
| `sessionMeta` | map | `{ userAgent, platform, appVersion }` — no IP, no precise location |
| `serverTimestamp` | timestamp | `FieldValue.serverTimestamp()`, never a client clock |

---

## `workspaces/{workspaceId}/dailySummaries/{YYYY-MM-DD}`

Performance cache. Document ID **is** the ledger date, so the dashboard reads
one document instead of aggregating a day's entries.

| Field | Type |
|---|---|
| `ledgerDate` / `workspaceId` | string |
| `openingBalancePaise` / `closingBalancePaise` | int |
| `totalIncomePaise` / `totalExpensePaise` / `netCashFlowPaise` | int |
| `transferInPaise` / `transferOutPaise` | int |
| `entryCount` / `confirmedCount` | int |
| `byAccount` | map<accountId, {incomePaise, expensePaise, closingPaise}> |
| `byCategory` | map<categoryId, {totalPaise, count}> |
| `isLocked` | boolean |
| `rebuiltAt` / `updatedAt` | timestamp |

**Client writes: none.** Maintained transactionally alongside the entry that
changes it. `scripts/rebuild-summaries.js` regenerates every document in this
collection from `ledgerEntries` alone — the spec's requirement that summaries be
safely rebuildable from source. Reconciliation is asserted in
`tests/integration/summary-reconciliation.test.js`.

---

## `workspaces/{workspaceId}/voucherCounters/{counterId}`

Counter ID format: `{prefix}-{financialYear}`, e.g. `INC-2026`, `TRF-2026`.

| Field | Type | Notes |
|---|---|---|
| `counterId` / `workspaceId` | string | |
| `prefix` | `'INC' \| 'EXP' \| 'TRF' \| 'COR'` | |
| `financialYear` | string | `'2026'` |
| `lastNumber` | int | Last allocated sequence |
| `updatedAt` | timestamp | |

**Client writes: none.** Incremented only inside the same Firestore transaction
that writes the entry, guaranteeing no gap-free-but-duplicated numbers and no
number allocated to an entry that failed to save.

---

## `workspaces/{workspaceId}/idempotency/{requestId}`

Document ID is the caller's `clientRequestId`. Written in the same transaction
as the operation it guards.

| Field | Type |
|---|---|
| `requestId` / `workspaceId` / `uid` | string |
| `operation` | string |
| `resultRef` | string — path of the document created |
| `resultSummary` | map — enough to return to a retrying client |
| `createdAt` | timestamp |
| `expiresAt` | timestamp — 30-day TTL policy |

A retry with the same key finds this document and returns `resultSummary`
instead of performing the operation again. This is what makes a dropped
response on a flaky mobile connection safe.

---

## `workspaces/{workspaceId}/lockDates/{lockId}` and `settings/{doc}`

`lockDates` keeps the history of lock/unlock actions; the *current* lock date
lives at `settings/accounting.lockDate` so a rule can read it with one `get()`.

`settings` documents: `accounting`, `pdf`, `sharing`, `notifications`.

---

## Composite indexes required

Generated into `firestore.indexes.json`.

| Collection | Fields | Serves |
|---|---|---|
| `ledgerEntries` | `status ASC, ledgerDate DESC, createdAt DESC` | Daily ledger, dashboard recents |
| `ledgerEntries` | `ledgerDate ASC, type ASC, status ASC` | Daily report, income/expense split |
| `ledgerEntries` | `accountId ASC, ledgerDate DESC, status ASC` | Account statement |
| `ledgerEntries` | `categoryId ASC, ledgerDate DESC, status ASC` | Category reports |
| `ledgerEntries` | `enteredBy ASC, ledgerDate DESC` | User-wise report |
| `ledgerEntries` | `type ASC, financialYear ASC, voucherNumber DESC` | Voucher lookup |
| `ledgerEntries` | `status ASC, enteredBy ASC, updatedAt DESC` | My drafts |
| `ledgerEntries` | `transferId ASC, ledgerDate DESC` | Transfer report |
| `transfers` | `status ASC, ledgerDate DESC` | Transfer list |
| `correctionRequests` | `status ASC, requestedAt DESC` | Approval queue |
| `auditLogs` | `entityType ASC, entityId ASC, serverTimestamp DESC` | Entity history |
| `auditLogs` | `actorUid ASC, serverTimestamp DESC` | User activity |
| `auditLogs` | `action ASC, serverTimestamp DESC` | Filtered audit report |
| `notifications` | `readAt ASC, createdAt DESC` | Unread panel |

---

## Transaction and batch boundaries

| Operation | Boundary | Writes inside it |
|---|---|---|
| Confirm entry | Transaction | entry, voucherCounter, dailySummary, accountBalance, auditLog, idempotency |
| Confirm transfer | Transaction | transfer, out-leg entry, in-leg entry, voucherCounter, 2 accountBalances, dailySummary, auditLog, idempotency |
| Approve correction | Transaction | reversal entry, replacement entry, original entry status, correctionRequest, counters, summaries, auditLog, idempotency |
| Lock date | Transaction | settings/accounting, affected entries → `locked`, lockDates doc, auditLog |
| Reorder categories | Batch | N category docs (no financial effect, so a batch is sufficient) |
| Create workspace | Transaction | workspace, member, 4 accounts, 6 categories, 4 settings docs, auditLog |

A Firestore transaction is limited to 500 writes. Lock-date operations over a
large period are therefore chunked by the function, with each chunk idempotent
and the lock only committed after the final chunk succeeds.

---

## Query patterns the UI actually issues

```js
// Daily ledger for one date
where('ledgerDate', '==', date)
  .where('status', 'in', ['confirmed', 'locked', 'corrected'])
  .orderBy('createdAt', 'desc')

// Dashboard — recent confirmed
where('status', 'in', ['confirmed','locked'])
  .orderBy('ledgerDate','desc').orderBy('createdAt','desc').limit(10)

// My drafts
where('status','==','draft').where('enteredBy','==',uid)
  .orderBy('updatedAt','desc')

// Account statement
where('accountId','==',id).where('ledgerDate','>=',from)
  .where('ledgerDate','<=',to).orderBy('ledgerDate','asc')
```

All list queries are paginated with `startAfter(cursor)` and `limit(50)`. No
screen ever issues an unbounded read.
