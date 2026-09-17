/**
 * PMExps — Audit log and period locking
 * @module views/audit
 */

import { el } from '../utils/dom.js';
import { renderPage, pageHeader, goTo } from '../components/shell.js';
import { field, dateInput, textArea, toast, setBusy, setFormError, confirmDialog } from '../components/ui.js';
import { getState } from '../state.js';
import { listAudit } from '../repositories/audit.js';
import { getLockDate, lockPeriod, reopenPeriod, previewLock } from '../services/lock.js';
import { formatTimestamp, formatLedgerDate, todayLedgerDate } from '../utils/dates.js';
import { ROLE } from '../config/constants.js';

const ACTION_LABEL = {
  'entry.confirm': 'Entry confirmed',
  'transfer.confirm': 'Transfer recorded',
  'period.lock': 'Period closed',
  'period.reopen': 'Period reopened',
};

export async function renderAudit() {
  const { workspaceId, role, user } = getState();

  async function draw() {
    const [rows, lockDate] = await Promise.all([
      listAudit(workspaceId, role === ROLE.SUPER_ADMIN ? {} : { actorUid: user?.uid }),
      getLockDate(workspaceId),
    ]);

    renderPage(
      pageHeader({
        title: 'Audit log',
        subtitle:
          role === ROLE.SUPER_ADMIN
            ? 'Every recorded action in this workspace.'
            : 'Your own recorded actions.',
        actions: [el('button', { class: 'btn', type: 'button', onClick: () => goTo('/settings') }, 'Settings')],
      }),

      el(
        'div',
        { class: 'alert alert--info' },
        'These rows are append-only. Nobody — including a Super Admin — can edit or remove one, and the timestamps come from the server rather than from any device.',
      ),

      role === ROLE.SUPER_ADMIN && lockSection(lockDate, draw),

      el(
        'section',
        { class: 'stack' },
        el('h2', {}, 'Activity'),
        rows.length === 0
          ? el(
              'div',
              { class: 'empty-state' },
              el('p', { class: 'u-weight-medium' }, 'Nothing recorded yet'),
              el('p', { class: 'u-text-sm' }, 'Confirmations, transfers and period closures appear here.'),
            )
          : el(
              'div',
              { class: 'stack stack--tight' },
              ...rows.map((row) =>
                el(
                  'article',
                  { class: 'txn-card' },
                  el(
                    'div',
                    { class: 'row row--between' },
                    el('span', { class: 'u-weight-medium' }, ACTION_LABEL[row.action] ?? row.action),
                    el('span', { class: 'u-text-xs u-text-muted tnum' }, row.entityLabel ?? ''),
                  ),
                  el(
                    'div',
                    { class: 'row row--between u-text-xs u-text-muted' },
                    el('span', {}, row.actorName || row.actorUid),
                    el('span', {}, formatTimestamp(row.serverTimestamp)),
                  ),
                  row.reason && el('p', { class: 'u-text-xs' }, `Reason: ${row.reason}`),
                ),
              ),
            ),
      ),
    );
  }

  /** @param {string|null} lockDate @param {() => void} refresh */
  function lockSection(lockDate, refresh) {
    const state = { lockDate: lockDate ?? todayLedgerDate(), reason: '' };
    const errorBox = el('div', {});
    const lockButton = el('button', { class: 'btn btn--primary', type: 'button' }, 'Close period');

    lockButton.addEventListener('click', async () => {
      setFormError(errorBox, null);
      try {
        const preview = await previewLock(workspaceId, state.lockDate);
        const ok = await confirmDialog({
          title: `Close the books through ${state.lockDate}?`,
          message:
            `${preview.confirmed} confirmed ${preview.confirmed === 1 ? 'entry' : 'entries'} will be sealed and can no longer be edited.` +
            (preview.drafts > 0
              ? ` ${preview.drafts} draft ${preview.drafts === 1 ? 'entry is' : 'entries are'} dated inside this period and will NOT be sealed — they stay as drafts and cannot be confirmed afterwards without reopening.`
              : '') +
            ' Correcting a sealed entry afterwards needs a correction, which keeps the original on record.',
          confirmLabel: 'Close period',
        });
        if (!ok) return;

        const restore = setBusy(lockButton, 'Closing…');
        const { lockedCount } = await lockPeriod({
          workspaceId,
          lockDate: state.lockDate,
          reason: state.reason,
        });
        restore();
        toast(`Period closed. ${lockedCount} entries sealed.`);
        refresh();
      } catch (error) {
        setFormError(errorBox, error?.message ?? 'Could not close the period.');
      }
    });

    const reopenButton = el('button', { class: 'btn btn--danger', type: 'button' }, 'Reopen period');
    reopenButton.addEventListener('click', async () => {
      setFormError(errorBox, null);
      const ok = await confirmDialog({
        title: 'Reopen the closed period?',
        message:
          'New entries will be allowed in dates that are currently sealed. Entries already locked stay locked. This is recorded in the audit log as a reopening, separately from routine closures.',
        confirmLabel: 'Reopen',
        destructive: true,
      });
      if (!ok) return;

      try {
        await reopenPeriod({ workspaceId, newLockDate: null, reason: state.reason });
        toast('Period reopened');
        refresh();
      } catch (error) {
        setFormError(errorBox, error?.message ?? 'Could not reopen.');
      }
    });

    return el(
      'section',
      { class: 'stack' },
      el('h2', {}, 'Accounting period'),
      el(
        'div',
        { class: 'card stack' },
        el(
          'p',
          { class: 'u-text-sm' },
          lockDate
            ? `Books are closed through ${formatLedgerDate(lockDate)}. Nothing on or before that date can be added, edited or confirmed.`
            : 'No period is closed. Entries can be made on any open date.',
        ),
        field({
          label: 'Close through',
          control: dateInput({
            value: state.lockDate,
            onChange: (value) => { state.lockDate = value; },
          }),
          hint: 'Everything on or before this date is sealed.',
        }),
        field({
          label: 'Reason',
          required: true,
          control: textArea({
            maxlength: 500,
            placeholder: 'Month-end close for August, reconciled against bank statement',
            onInput: (value) => { state.reason = value; },
          }),
          hint: 'At least 10 characters. Stored permanently in the audit log.',
        }),
        errorBox,
        el('div', { class: 'row u-gap-2' }, lockButton, lockDate && reopenButton),
      ),
    );
  }

  await draw();
}
