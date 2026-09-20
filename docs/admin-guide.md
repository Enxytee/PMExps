# PMExps — Administrator guide

For the Super Admin of a workspace.

---

## Roles

| | Super Admin | Accountant | Viewer |
|---|:---:|:---:|:---:|
| View ledger and reports | yes | yes | yes |
| Create and edit drafts | yes | yes | — |
| Confirm entries | yes | yes | — |
| Record transfers | yes | yes | — |
| Request a correction | yes | yes | — |
| Approve a correction | yes | — | — |
| Close and reopen periods | yes | — | — |
| Manage accounts and categories | yes | — | — |
| Manage members | yes | — | — |
| Audit log | all | own actions | — |
| Delete financial history | **no** | **no** | **no** |

That last row is not an oversight. There is no code path, and no security rule,
that permits deleting a ledger entry, a transfer or an audit row. Drafts are
retired to a recoverable state; accounts and categories are deactivated.

---

## First-time setup

**Settings → Business details.** Business name, address, phone and email.
These print at the top of every daily ledger page. Leave any blank and it is
simply left off.

**Settings → Accounts.** Four are created for you: Cash, Bank, UPI/Card,
Person/Party. Set the real opening balance and the date it applies from — an
account's opening balance only counts from that date, so an account added
mid-year does not retroactively change last quarter.

**Settings → Categories.** Six are created, three income and three expense.
Add your own. Each has a **ગુ name** button for the Gujarati label used on
printed pages.

A category's **type cannot be changed once it has entries**. Flipping income to
expense would invert the sign of every historical entry behind it. Deactivate
it and create a new one instead.

---

## Adding people

Not yet built. Membership changes go through a callable function that does not
exist on the free plan. For now, one person per workspace.

The security rules for it are written and deployed: only a Super Admin may
invite, a new member starts as *invited* rather than active, and **nobody can
change their own role** — including a Super Admin, which is what prevents the
last administrator being tricked into demoting themselves.

---

## Closing a period

**Corrections → Audit log → Accounting period.**

Choose a date, give a reason of at least 10 characters, and confirm. Everything
on or before that date is sealed: no new entries, no edits, no confirmations.

Before you confirm, the dialog tells you how many entries will be sealed and
how many **drafts** are dated inside the period. Drafts are not sealed and
cannot be confirmed afterwards without reopening — so deal with them first.

**Reopening** is possible, recorded as a separate action in the audit log with
its own reason. Entries already locked stay locked; reopening allows new work
in those dates, it does not unseal what was sealed.

---

## Reviewing corrections

**Corrections** lists what is waiting. Each shows only the fields that actually
differ, the reason, and who asked.

Approving writes a reversal and produces a corrected draft. Rejecting leaves
the entry untouched.

Both are permanent audit entries. Neither can be undone, only followed by
another correction.

---

## The audit log

Append-only. Nobody — including you — can edit or delete a row. Timestamps come
from the server, not from any device.

An Accountant sees only their own actions; a Super Admin sees everything.

Caveat worth knowing: without Cloud Functions, audit rows are written by the
browser as part of the same transaction as the action. Rules prevent forging
someone else's name or back-dating, but a modified client could omit writing
one. See `docs/test-report.md`.

---

## What to check monthly

1. In any ledger report, the **Transfer column totals zero**. If not, a
   transfer lost a leg.
2. Dashboard **Overall balance** matches what you actually hold.
3. No forgotten drafts sitting in **Drafts**.
4. Close the month once the books agree.
