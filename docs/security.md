# PMExps — Security

## What protects your data

1. **Firestore Security Rules** — the real boundary, enforced by Google's
   servers on every read and write
2. **Firebase Authentication** with an authorized-domain list
3. **Storage Rules** for attachments
4. The application code — a convenience layer, not a boundary

If the entire JavaScript in this project were replaced by hostile code, the
ledger would still be protected by items 1 to 3. That is the design intent, and
the reason rules are written to re-derive every check rather than trust
anything the client sends.

---

## The Firebase config in the repository is not a secret

`js/config/firebase-config.js` is committed and the repository is public. That
is correct. A Firebase web config ships to every browser that loads any
Firebase web app; Google documents it as public. It identifies the project, it
does not authorise anything.

**Never commit:** service-account JSON, Admin SDK private keys, third-party API
secrets. `.gitignore` blocks the usual filenames, and CI fails the build if a
credential file appears in a commit.

**Do restrict the API key** anyway: Google Cloud Console → Credentials → your
browser key → Application restrictions → Websites, and add
`https://enxytee.github.io/*` and `http://localhost:5173/*`. This stops someone
copying the key and burning your quota from their own site.

---

## How the rules hold the line

**Tenant isolation comes from the document path.** Everything lives under
`workspaces/{id}/…`, so a cross-workspace read is refused by a path match
rather than by trusting a `where` clause the client supplied.

**Membership is checked on every operation.** Being signed in grants nothing.
Access requires an *active* member document; `invited` and `deactivated` grant
nothing.

**Nobody can change their own role.** Not even a Super Admin. Self-exclusion is
what prevents the last administrator being manipulated into demoting
themselves.

**Voucher numbers are bound to a counter.** The counter may only ever increase
by one, and an entry's voucher number must equal the counter's value *after*
the same commit, checked with `getAfter()`. A tampered client cannot invent a
number, reuse one, or skip a range.

**Transfers must balance.** Both legs are inspected with `getAfter()` before
the commit is allowed: same amount, same date, same transfer ID, opposite
directions, correct accounts. A half-written transfer cannot be stored.

**Confirmed entries are immutable.** The confirmation rule requires every
financial field to be byte-identical to the draft. An amount cannot change on
its way through confirmation.

**Audit logs are append-only**, with `actorUid` pinned to the caller and the
timestamp pinned to the server clock.

---

## Input handling

No user-supplied text is ever assigned to `innerHTML`. Descriptions, party
names and remarks reach the page as text nodes through `el()` in
`js/utils/dom.js`. `escapeHtml` exists for the two places that genuinely build
markup as a string.

**CSV exports are protected against formula injection.** A cell beginning with
`=`, `+`, `-` or `@` is neutralised with a leading apostrophe, so a description
typed as `=HYPERLINK("http://evil","Click")` cannot execute when an accountant
opens the file. Plain numbers, including negatives, are exempt — an earlier
version mangled every negative amount into text.

A **Content-Security-Policy** meta tag restricts scripts to this origin and
`gstatic.com`, and connections to the Firebase endpoints only.

**Account numbers are stored masked.** Only the last four digits
(`••••3421`) are kept. Nothing in the app needs the full number, and a full
account number in a browser-readable document is a liability with no upside.

---

## The honest caveats

**The rules have never been executed.** See `docs/test-report.md`. They publish
without syntax errors, and one logic error was already found in use. Run
`tests/rules/` against the emulator before trusting this with real money.

**There is no trusted server.** Without Cloud Functions, balance-affecting
operations are client-issued transactions. The invariants are enforced by
rules, which is sound — but it puts all the weight on rules that have not been
tested.

**Audit rows depend on the client writing them.** Rules prevent forgery, not
omission.

**Reopening a closed period is possible** by a Super Admin. Visible in the
audit log, not prevented.

---

## If you suspect a compromise

1. Firebase Console → Authentication → disable the affected account
2. Change the workspace owner's password
3. Review the audit log for that user's actions
4. Google Cloud Console → rotate the API key and re-restrict it
5. Nothing can have been deleted — every financial record is append-only, so
   the history is intact and any injected entry can be reversed
