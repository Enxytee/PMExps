# PMExps — User guide

For anyone recording daily income and expenses.

---

## The one idea to understand first

Every entry is either a **draft** or **confirmed**.

A draft is a note to yourself. It appears in the ledger marked *Draft*, it can
be edited or removed, and **it does not affect a single balance**.

Confirming is the moment it becomes part of the books. It gets a permanent
voucher number like `INC-2026-00001`, it counts in every total, and **it can no
longer be edited**. If it turns out to be wrong, you request a correction —
which leaves the original visible and writes a reversal beside it.

This separation is the whole point of the app. Nothing you are unsure about can
quietly end up in your totals.

---

## Recording income or an expense

1. **Add Entry**
2. Choose **Income** or **Expense**
3. Type the amount. `1250`, `1250.50` and `1,25,000` all work
4. Pick the date, category, account and payment mode
5. Write a short description
6. **Save as draft**

It now appears in **Drafts** and in the ledger, not counted anywhere.

### Confirming

Open **Drafts** and press **Confirm**. You will be asked to check the amount
and date first, because after this it cannot be edited.

**Confirm all** does the whole list, in order, each getting its own number. Any
that fail stay as drafts and are reported.

---

## Moving money between your own accounts

Use **Transfer**, not two entries.

A transfer writes two matching lines at once — one leaving, one arriving. Your
overall balance does not change, only where the money sits. It is not income
and not an expense, and no report will treat it as either.

Money cannot move to the account it is already in; the form refuses.

---

## Fixing a mistake

**A draft:** just edit it.

**A confirmed entry:** open the ledger, find the row, press **Correct**. Enter
the right figures and a reason (at least 10 characters). A Super Admin reviews
it.

When approved:

- A **reversal** is written that cancels the original — `COR-2026-00001`
- The **original stays** in the ledger, marked as corrected
- The **corrected version** appears in Drafts for you to confirm

All three remain visible. Someone reading the ledger in a year can see exactly
what happened and why.

**A transfer** cannot be corrected, only reversed — Corrections → *Reverse a
transfer*. A reversal cannot itself be reversed; if that one was also wrong,
record a new transfer for what should have happened.

---

## The daily page for your accountant

**Ledger → Print / Share.**

An A4 page opens with your business name, the day's entries, opening and
closing balance, and a signature line.

- **English / ગુજરાતી** switches the whole page
- **Print / Save as PDF** — in the print dialog set Destination to *Save as
  PDF*, and turn **off** "Headers and footers" so the browser does not print
  its own date and title across the top
- **Send figures** opens WhatsApp with the day's totals as a message. It does
  **not** attach the PDF — save that first and attach it yourself

---

## Reports

**Reports** has eleven views of the same data: date range, monthly, by account,
by category, by person, income versus expense, transfers, balances, and
corrections.

**Export CSV** opens in Excel with amounts as real numbers you can sum.

One thing worth knowing: in the ledger reports, **Income and Expense exclude
transfers**, and transfers have their own column. That column should always
total zero — if it does not, a transfer has lost a leg and something needs
looking at. On an **account statement** transfers do appear in the In and Out
columns, because money genuinely entered or left that account.

---

## Working without a connection

Drafts work offline. They save on your device and sync when you are back.

These need a connection, and the app will say so rather than failing quietly:

- Confirming an entry
- Recording a transfer
- Closing a period
- Approving a correction

All four take the next voucher number from the server. Offline, two devices
could hand the same number to different entries.

---

## Installing on your phone

Open the site in Chrome and choose **Add to Home screen**. It then opens like
an app and works offline for drafts.
