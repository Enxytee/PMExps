# PMExps — Deployment

Repository: `Enxytee/PMExps`
Live URL: **https://enxytee.github.io/PMExps/**
Firebase project: `pmexps`

The capitalisation matters. GitHub Pages paths are case-sensitive, so
`/pmexps/` and `/PMExps/` are different URLs and only the second one exists.

---

## 1. Create the repository

On the screen you had open, keep these settings:

| Field | Value | Why |
|---|---|---|
| Owner / name | `Enxytee` / `PMExps` | |
| Visibility | Public | Free Pages. Private repos need a paid plan for Pages |
| Add README | **Off** | One is already written; letting GitHub add another makes your first push a conflict |
| Add .gitignore | **None** | Already written, and it blocks credential filenames GitHub's template does not |
| Add license | **None** | MIT `LICENSE` is already in the project |

Then click **Create repository**.

### On "Public"

Public is fine and is what I assumed. The Firebase web config in
`js/config/firebase-config.js` is not a secret — it ships to every browser that
loads any Firebase web app. What protects your ledger is `firestore.rules`,
`storage.rules`, the Cloud Functions, and the authorized-domains list.

What must never be committed, public or private:

- service-account JSON (`*-service-account*.json`, `serviceAccountKey.json`)
- Admin SDK private keys
- any third-party API secret

`.gitignore` blocks those filenames, and the CI job in `.github/workflows/test.yml`
fails the build if a service-account credential or a private key block ever
appears in a tracked file.

---

## 2. Push the project

From the project folder:

```bash
git init
git add .
git commit -m "Phase 1: architecture, design system, Firebase data model"
git branch -M main
git remote add origin https://github.com/Enxytee/PMExps.git
git push -u origin main
```

---

## 3. Turn on GitHub Pages

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

Not "Deploy from a branch". The workflow in `.github/workflows/deploy-pages.yml`
publishes through the Actions artifact pipeline, and selecting branch mode
instead would serve the raw repository — including `functions/` and `tests/`.

The first deploy runs automatically on your push to `main`. Watch it under the
**Actions** tab. It will:

1. Run the unit tests. A failure stops the deploy.
2. Check that role names in `firestore.rules` and `js/config/constants.js` agree.
3. Refuse to deploy if a service-account credential is present.
4. Assemble `_site/`, excluding `functions/`, `tests/`, `scripts/` and the
   Firebase config files.
5. Write `.nojekyll`, without which Jekyll silently drops any file or folder
   starting with an underscore.
6. Stamp the commit SHA into the app version, so the running site can tell you
   exactly what is deployed.
7. Deploy, then curl the live URL and fail if `index.html`, `manifest.webmanifest`,
   `css/tokens.css` or `js/app.js` returns anything other than 200.

---

## 4. Add the Pages domain to Firebase Authentication

**Firebase Console → Authentication → Settings → Authorized domains → Add domain.**

Add exactly:

```
enxytee.github.io
```

The hostname only — no `https://`, no `/PMExps/` path. Firebase authorizes
domains, not paths.

`localhost` is authorized by default, which is why sign-in works locally and
then fails in production if this step is skipped. The failure looks like
`auth/unauthorized-domain`.

---

## 5. Restrict the API key

The web API key is public by design, but leaving it unrestricted means anyone
who copies it can burn your project quota from their own site.

**Google Cloud Console → APIs & Services → Credentials →** your Browser key **→
Application restrictions → Websites**, then add:

```
https://enxytee.github.io/*
http://localhost:5173/*
```

Under **API restrictions**, limit the key to: Identity Toolkit API, Token
Service API, Cloud Firestore API, Firebase Installations API, Cloud Storage
for Firebase API.

Do this after the first successful production sign-in, not before — it is
easier to tell a restriction problem from a rules problem when only one of them
is new.

---

## 6. Verify

Open https://enxytee.github.io/PMExps/. The Phase 1 shell reports its own
environment. Check the **Base path** card reads `/PMExps/` and the asset URL
line begins with `https://enxytee.github.io/PMExps/`.

If the base path shows `/` on the live site, the deployment landed at the wrong
root and Phase 2 assets will 404.

---

## Notes for later phases

**Cloud Functions do not deploy from GitHub Actions yet.** Doing so needs a
service-account key in repository secrets, and that key is exactly the
credential that must not be casually created. Until Phase 10 sets up Workload
Identity Federation, functions deploy from your machine:

```bash
firebase deploy --only functions
firebase deploy --only firestore:rules,storage:rules
firebase deploy --only firestore:indexes
```

**Rules and indexes also deploy from your machine**, deliberately. A security
rule change is the one deployment that should never happen automatically on a
push.

**Custom domain** is optional. If you add one, the base path becomes `/`, which
`js/utils/base-path.js` detects at runtime — no code change needed. You would
add a `CNAME` file to the published output and add the new hostname to Firebase
authorized domains.

**Service worker caching** (Phase 8) makes stale deploys possible. The version
stamp from step 3.6 is what will let the update notification know a new build
exists.
