# PMExps

Daily income, expense and transfer ledger for personal, family and
small-business accounts. Vanilla ES modules on GitHub Pages, Firebase for
authentication, data, storage and trusted financial operations.

**Live:** https://enxytee.github.io/PMExps/ · **Firebase project:** `pmexps`

No build step for the frontend. Node tooling is used only for tests, linting,
Cloud Functions and deployment.

---

## Current status — Phase 1 of 10 complete

| Phase | Scope | Status |
|---|---|---|
| 1 | Architecture, project structure, design system, Firebase data model | **Done** |
| 2 | Authentication, workspace membership, role security | Next |
| 3 | Accounts, categories, ledger drafts | |
| 4 | Confirmation, voucher numbering, balances | |
| 5 | Transfers, corrections, lock dates, audit logs | |
| 6 | Dashboard, reports, filters, exports | |
| 7 | A4 PDF generation, WhatsApp sharing | |
| 8 | Offline drafts, PWA, localisation, themes | |
| 9 | Automated tests, accessibility, security verification | |
| 10 | GitHub Actions, Pages deployment, documentation, QA | |

---

## What exists right now

```
css/tokens.css          Design tokens — every colour, size, radius, timing
css/themes.css          Dark (default) and light palettes
css/base.css            Reset, typography, focus, a11y primitives, tabular numerals
css/layout.css          App frame: sidebar + topbar / header + bottom nav
css/utilities.css       Small utility set
css/responsive.css      Breakpoints; table becomes cards below 768px
css/print.css           A4 print rules: repeating headers, no split rows

js/utils/money.js       Integer-paise arithmetic, parsing, Indian formatting
js/utils/dates.js       Ledger dates, IST handling, financial years
js/utils/dom.js         Safe DOM construction, escaping, focus trapping
js/config/constants.js  Roles, permissions, statuses, transitions, defaults
js/config/firebase-config.js  Web config for project `pmexps`

firestore.rules         Production rules: tenant isolation, role enforcement
storage.rules           Workspace-scoped attachment rules
firestore.indexes.json  27 composite indexes
firebase.json           Emulator + deploy configuration
docs/data-model.md      Full schema: fields, types, indexes, transactions

js/utils/base-path.js   Runtime base path — works at /PMExps/ or a root domain
js/services/theme.js    Theme switching, persistence, system-theme following
js/app.js               Bootstrap; reports its own environment for base-path checks

index.html              App shell with pre-paint theme bootstrap and CSP
404.html                Deep-link recovery for hash routing on Pages
manifest.webmanifest    PWA manifest with maskable icons and app shortcuts
assets/images/          Generated icon set (16 to 512, maskable, SVG, ICO)

.github/workflows/test.yml          Unit tests, rule/constant drift check, credential scan
.github/workflows/deploy-pages.yml  Gated deploy + live smoke test
docs/deployment.md                  Repo, Pages, authorized domains, key restriction
tests/unit/money.test.js            53 passing tests
```

---

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
npm run test:unit      # 53 tests, no emulator needed
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
