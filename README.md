# PMExps

Daily income, expense and transfer ledger for personal, family and
small-business accounts. Vanilla ES modules on GitHub Pages, Firebase for
authentication and data.

Runs entirely on Firebase's free plan. There are no Cloud Functions: the
operations that would normally need a trusted server — allocating voucher
numbers, confirming entries, balancing transfers — are client-issued Firestore
transactions whose invariants are enforced by security rules using
`getAfter()`.

**Live:** https://enxytee.github.io/PMExps/ · **Firebase project:** `pmexps`

No build step for the frontend. Node tooling is used only for tests and
deployment.

---

## Status

All ten phases built. **169 automated tests pass.**

| Phase | Scope | |
|---|---|:---:|
| 1 | Architecture, design system, Firebase data model | done |
| 2 | Authentication, workspaces, role security | done |
| 3 | Accounts, categories, ledger drafts | done |
| 4 | Confirmation, voucher numbering, balances | done |
| 5 | Transfers, period locking, audit log | done |
| 6 | Corrections and transfer reversals | done |
| 7 | Eleven reports, CSV export | done |
| 8 | A4 printable ledger in English and Gujarati, WhatsApp | done |
| 9 | Offline drafts, PWA, connectivity guards | done |
| 10 | Documentation and final QA | done |

**Read `docs/test-report.md` before trusting this with real money.** It is
honest about what has not been verified — in particular, the 900 lines of
security rules that enforce every financial invariant have never been executed
against the emulator.

## Documentation

| | |
|---|---|
| `docs/user-guide.md` | Recording entries, transfers, corrections, printing |
| `docs/admin-guide.md` | Roles, setup, closing periods, reviewing corrections |
| `docs/setup.md` | Building this on a fresh Firebase project |
| `docs/deployment.md` | GitHub Pages, authorized domains, API key |
| `docs/security.md` | What protects the data, and the caveats |
| `docs/backup-recovery.md` | There are no automated backups. Read this one |
| `docs/data-model.md` | Firestore schema, indexes, transaction boundaries |
| `docs/test-report.md` | What is tested, what is not, known limitations |

## Not built

Attachments, member invitations, scheduled backups, and automatic PDF
generation. Each is explained in `docs/test-report.md` under Known limitations.

## Two things worth reading before Phase 2

**Money is never a float.** Every amount is an integer number of paise.
`₹1,25,000.00` is the integer `12500000`. Parsing happens once at the input
boundary (`parseAmountToPaise`), formatting once at the render boundary
(`formatPaise`), and everything between is integer addition. See
`js/utils/money.js`.

**The client cannot write a role, a voucher number, or a confirmed entry.**
Not "the UI hides it" — there is no rule in `firestore.rules` that permits it.
Confirmation, locking, transfers, corrections and voucher allocation are
callable Cloud Functions. This is why privilege escalation and history
rewriting are structurally impossible rather than merely disallowed.

---

## Running what exists

```bash
npm install
npm test               # 169 tests, no emulator needed
npm run dev            # static server on http://localhost:5173
```

Firebase emulators, seed data and the full test matrix arrive with Phase 2,
when there is authentication to test against.

## Deploying

See `docs/deployment.md`. Short version: push to `main`, set
**Settings → Pages → Source: GitHub Actions**, and add `enxytee.github.io` to
Firebase **Authentication → Settings → Authorized domains**.

---

## Security note on the committed Firebase config

`js/config/firebase-config.js` contains the Firebase **web** config. These
values are not secrets — Google ships them to every browser that loads any
Firebase web app. Your data is protected by security rules, Cloud Function
validation, and Authentication authorized domains.

Never commit: service-account JSON, Admin SDK private keys, or third-party API
secrets. Those go in Cloud Functions secrets (`firebase functions:secrets:set`).

`.gitignore` already blocks `*-service-account*.json` and `serviceAccountKey.json`.

---

## Licence

See `LICENSE`.
