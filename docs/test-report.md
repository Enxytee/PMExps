# PMExps — Test report

Last updated at the end of Phase 10.
Automated suite: **169 tests, all passing** (`npm test`).

This document is deliberately blunt about what has *not* been verified. A test
report that reads as uniformly green is worse than useless, because it tells
you nothing about where to be careful.

---

## What the automated tests cover

| Area | Tests | What they actually prove |
|---|---:|---|
| Money | 53 | Parsing, formatting, Indian grouping, and that no monetary value ever becomes a float |
| Reports | 36 | Every report builder, column-to-total reconciliation, CSV escaping and formula-injection defence |
| Balances | 33 | Opening/closing arithmetic, transfers netting to zero, reversals cancelling correctly |
| Validation | 19 | Entry, account and category rules, including category/type mismatch and lock dates |
| Localisation | 10 | Every English key has a Gujarati translation; fallback never leaves a blank |
| Navigation | 8 | Routing, and that the shell rebuilds after the print view replaces it |
| Connectivity | 6 | Counter-dependent operations refuse to run offline |
| Build phase | 4 | The progress banner cannot go stale |

Run them with:

```bash
npm install
npm test
```

### Three bugs these tests exist because of

Each of these shipped, was found in use, and now has a test that fails without
the fix. They are listed because they show the *kind* of mistake this codebase
is prone to.

1. **A hidden ledger row.** A sticky table header covered the first row of a
   report. The totals were still correct, so nothing looked wrong — the row
   was simply invisible. Found by counting rows against the "6 entries" label.

2. **Negative amounts arriving in Excel as text.** The CSV formula-injection
   guard prefixed every cell starting with `-`, which includes every negative
   amount. Excel then silently excluded them from column sums. This hit
   reversals and party accounts in debit: exactly the figures someone checks.

3. **A Back button that did nothing.** The print view replaces the whole app
   container; `renderPage()` then had nowhere to draw and returned silently.
   No error, no navigation, nothing in the console.

All three were invisible from reading the code and obvious in use.

---

## What is NOT verified, and why it matters

### Security rules have never been executed

`firestore.rules` is 900 lines and enforces every financial invariant in the
system: voucher numbers bound to a counter, transfers balancing across two
legs, roles, tenant isolation. **None of it has been run.**

The Firestore emulator could not be downloaded in the environment where this
was built. `tests/rules/confirm.test.js` exists and is written, but has never
executed.

What this means in practice:

- A **syntax** error would have been caught: Firebase validates rules when you
  press Publish, and they published successfully.
- A **logic** error would not. One was found this way already — the transfer
  confirmation rule was written as an `update` when Firestore evaluates a new
  document as a `create`, so the leg-balancing check never ran. It was only
  discovered when a real transfer was refused.

**Before relying on this for real money**, run the rules tests:

```bash
npm install
npx firebase emulators:exec --only firestore "npx vitest run tests/rules"
```

Anywhere with normal internet access can do this. It takes a few minutes and
is the single highest-value thing left undone.

### The Gujarati PDF has not been verified as a saved file

Gujarati renders correctly **on screen**, confirmed visually: conjuncts join,
matras sit correctly. The printed page is HTML that the browser lays out, so
the shaping is the browser's, which is the reason for that design.

What has not been checked is a **saved PDF opened separately**. Font embedding
during PDF export can differ from screen rendering. Until someone saves one
and opens it, "Gujarati PDF works" is an inference, not a fact.

### Offline behaviour has not been tested on a real device

The connectivity guards are unit-tested with a simulated `navigator.onLine`.
Actual behaviour on a phone losing signal mid-entry — Firestore's write queue,
the service worker cache, recovery on reconnect — has not been exercised.

### Not tested at all

- Multiple users in one workspace at the same time
- Accountant and Viewer roles in use (only Super Admin has been exercised)
- More than a handful of entries; performance at thousands is unknown
- Screen readers, keyboard-only navigation
- Browsers other than Chrome
- Printing from a phone
- Attachments — the feature is specified but not built

---

## Known limitations

These are design decisions, not defects. Each was a deliberate trade.

**No Cloud Functions.** The project runs on Firebase's free plan, so there is
no trusted server process. Balance-affecting operations are client-issued
Firestore transactions, with the invariants enforced by security rules using
`getAfter()`. The security property holds — Firestore rejects a commit that
breaks an invariant — but it puts unusual weight on rules that have never been
executed. See above.

**No stored daily summaries.** Every figure is computed from ledger entries on
demand. Nothing can drift out of step, but reads grow with the ledger. At a few
thousand entries this will need revisiting; the `listUpTo` query is capped at
2,000 documents and will silently truncate beyond that.

**The app does not generate PDF files.** It produces a print-ready page and the
user saves it. JavaScript PDF libraries do not shape Gujarati text and produce
broken output; the browser does it correctly. The cost is a manual save step.

**WhatsApp sharing sends figures, not the PDF.** A web page cannot attach a
file it has not generated. The message carries opening balance, totals and
closing balance, and says plainly that the full page is separate.

**Audit logs are written by the client.** Without Cloud Functions there is no
alternative. Rules make them append-only and pin `actorUid` to the caller and
the timestamp to the server clock, so rows cannot be forged in someone else's
name or back-dated — but a determined client could omit writing one.

**Reopening a closed period is possible.** Rules can require a Super Admin and
record the action, but cannot judge whether the stated reason is true. It is
visible in the audit log rather than prevented, which is the right trade for a
system where a genuine mistake must remain fixable.

**Attachments are not implemented.** Storage rules are written and deployed,
the data model has the fields, but there is no upload UI.

**No automated backups.** See `docs/backup-recovery.md`.

---

## Recommended order of work from here

1. Run the security rules tests. Everything else is downstream of knowing
   whether the rules do what they claim.
2. Save a Gujarati PDF and open it.
3. Add a second user as an Accountant and confirm they cannot reach Settings,
   cannot lock a period, and cannot approve a correction.
4. Enter a month of real data and watch for anything that feels wrong.
5. Attachments, if bills need to be kept with entries.
