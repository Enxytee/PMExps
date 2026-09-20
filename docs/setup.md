# PMExps — Setup from scratch

Rebuilding this on a new Firebase project, or handing it to someone else.

Everything below is free-plan only. No card required.

---

## 1. Firebase project

1. console.firebase.google.com → **Add project** → name it
2. Google Analytics: **off** (it needs consent handling and adds nothing here)

## 2. Firestore

**Build → Firestore Database → Create database**

- **Location:** `asia-south1` (Mumbai) for an India-based ledger.
  **This cannot be changed afterwards** — a different region means a new
  project.
- **Start in production mode.** Test mode opens everything for 30 days and
  then breaks without warning.

## 3. Authentication

**Build → Authentication → Get started → Email/Password → Enable**

Leave *Email link (passwordless)* **off**. It needs separate configuration and
this app uses passwords.

## 4. Web app registration

**Project settings → General → Your apps → Web**

Copy the config object into `js/config/firebase-config.js`. These values are
not secret; see `docs/security.md`.

## 5. Security rules

**Firestore Database → Rules** → paste the whole of `firestore.rules` →
**Publish**.

**Storage → Rules** → paste `storage.rules` → **Publish**. Only needed once
attachments are built.

Publishing validates syntax. It does not validate logic — run the emulator
tests, see `docs/test-report.md`.

## 6. Indexes

The app will ask for an index the first time it needs one, with a direct link
that pre-fills everything. Press Create and wait for *Enabled*.

Or deploy them all at once:

```bash
npx firebase deploy --only firestore:indexes
```

You will definitely need the collection-group index on `members`
(`status`, `uid`) — the workspace picker cannot load without it.

## 7. Authorized domain

**Authentication → Settings → Authorized domains → Add domain**

Add the hostname only: `enxytee.github.io`. No `https://`, no path.

Skipping this is why sign-in works locally and fails in production with
`auth/unauthorized-domain`.

## 8. Restrict the API key

Google Cloud Console → APIs & Services → Credentials → your browser key →
Application restrictions → **Websites**:

```
https://enxytee.github.io/*
http://localhost:5173/*
```

Do this after the first successful production sign-in, so a restriction problem
cannot be confused with a rules problem.

## 9. GitHub Pages

See `docs/deployment.md`. Short version: push to `main`, then
**Settings → Pages → Source: GitHub Actions**.

## 10. First Super Admin

There is no special bootstrap step and no seed script to run.

Open the app, **Create an account**, then **Create workspace**. Whoever creates
a workspace becomes its Super Admin, and the default accounts and categories
are seeded automatically in both English and Gujarati.

The security rules make this safe: a workspace can only be created together
with its owner's member document, and that document must make the creator an
active Super Admin. The path cannot be replayed to mint a second one, because
it requires the workspace not to exist yet.

---

## Running locally

```bash
npm install
npm test          # 169 tests
npm run dev       # http://localhost:5173
```

The app detects localhost and will use the Firebase emulators if they are
running:

```bash
npx firebase emulators:start --only firestore,auth
```

Add `?production` to the URL to force it at production instead.

---

## Deploying a change

1. Edit the files
2. `npm test`
3. Upload the changed folders to GitHub (usually just `js`)
4. The Actions workflow runs the tests and deploys if they pass
5. **Ctrl+Shift+R** in the browser — the service worker caches aggressively

Rules and indexes are deployed by hand, deliberately. A security rule change
should never happen automatically on a push.
