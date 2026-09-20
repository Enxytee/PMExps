# PMExps — Backup and recovery

## What you have now

**No automated backups.** Scheduled Firestore exports require the Blaze plan.
On the free plan your data exists in exactly one place: your Firestore
database.

That is a real risk and it should be stated plainly rather than buried.

---

## What protects you anyway

**Nothing is ever deleted.** No role can delete a ledger entry, a transfer or
an audit row. Drafts are retired to a recoverable state. Accounts and
categories are deactivated, never removed.

So the realistic failure is not "someone deleted the books" — it is losing the
Firebase project itself, through an accidental deletion or a lost Google
account.

---

## Manual backup — do this monthly

The most practical option without Blaze:

1. **Reports → Date range**, set From to 1 April and To to today
2. **Export CSV**
3. Save it somewhere that is not the same Google account — an external drive,
   or email it to yourself

Repeat for **Transfers** and **Corrections**.

This is not a restorable database backup. It is a readable record of every
entry, which is what an accountant or a tax authority would actually ask for,
and it costs two minutes a month.

### Also back up

- **Firestore rules:** already in your GitHub repository
- **Business details:** a screenshot of Settings → Business details
- **Account opening balances:** they are in the balances report

---

## Proper backups, if you move to Blaze

Scheduled exports to Cloud Storage:

```bash
gcloud firestore export gs://YOUR-BUCKET/backups/$(date +%Y-%m-%d) \
  --project=pmexps
```

Schedule it daily with Cloud Scheduler. Retain 30 daily and 12 monthly copies.

Restore:

```bash
gcloud firestore import gs://YOUR-BUCKET/backups/2026-09-17 --project=pmexps
```

**Test a restore into a separate project before you need one.** An untested
backup is a guess.

Costs are small at this scale — storage is pennies per month — but the Blaze
plan requires a card.

---

## Recovery scenarios

**Wrong entry confirmed** → request a correction. Nothing is lost.

**Wrong transfer** → Corrections → Reverse a transfer.

**Period closed too early** → Reopen it. Recorded in the audit log.

**Someone deactivated an account by mistake** → Settings → Reactivate. Its
history was never touched.

**Firebase project deleted** → without an export, the data is gone. This is why
the monthly CSV matters.

**GitHub repository deleted** → the app is gone, the data is not. Re-upload the
code and point it at the same Firebase project.

---

## Responsibilities

Nobody is backing this up for you. Google keeps Firestore durable and
replicated, which protects against hardware failure — not against a deleted
project, a lost account, or a billing lapse.

One calendar reminder, once a month, to export the CSV.
