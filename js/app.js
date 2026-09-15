/**
 * PMExps — Application shell
 *
 * Guards the app, resolves which workspace to open, and renders the first
 * real screens: workspace picker, create workspace, and the dashboard shell.
 *
 * The guard order matters and is deliberate:
 *   1. Wait for the auth session to restore. Rendering before this shows a
 *      signed-in user a login redirect for one frame on every reload.
 *   2. No user → login page.
 *   3. User but no active membership → workspace picker. Being signed in is
 *      not access; a person with an account and no membership sees an empty
 *      picker, never someone else's ledger.
 *   4. Membership resolved → dashboard.
 *
 * @module app
 */

import { el, qs, replaceChildren, announce, setText } from './utils/dom.js';
import { basePath, isProjectSite } from './utils/base-path.js';
import { todayLedgerDate, formatLedgerDate, financialYear } from './utils/dates.js';
import { formatPaise } from './utils/money.js';
import { APP, ROLE } from './config/constants.js';
import { getPreference, setTheme, cycleTheme, watchSystemTheme } from './services/theme.js';
import { waitForAuthReady, signOut, currentUser, getUserProfile } from './services/auth.js';
import {
  listMyWorkspaces,
  resolveActiveWorkspace,
  setActiveWorkspaceId,
  createWorkspace,
  loadMasterData,
} from './services/workspaces.js';

/** Human labels for roles. These move to the localisation files in Phase 8. */
const ROLE_LABEL = {
  [ROLE.SUPER_ADMIN]: 'Super Admin',
  [ROLE.ACCOUNTANT]: 'Accountant',
  [ROLE.VIEWER]: 'Viewer',
};

const root = () => qs('#app');

/* -------------------------------------------------------------------------
   Shared chrome
   ------------------------------------------------------------------------- */

function pageHeader({ title, subtitle, actions = [] }) {
  return el(
    'header',
    { class: 'page-header' },
    el(
      'div',
      { class: 'page-header__titles' },
      el('h1', {}, title),
      subtitle && el('p', { class: 'page-header__subtitle' }, subtitle),
    ),
    el('div', { class: 'page-header__actions' }, ...actions),
  );
}

function themeButton() {
  const button = el(
    'button',
    {
      class: 'btn',
      type: 'button',
      onClick: () => {
        const next = cycleTheme();
        button.textContent = `Theme: ${next}`;
        announce(`Theme set to ${next}`);
      },
    },
    `Theme: ${getPreference()}`,
  );
  return button;
}

function signOutButton() {
  return el(
    'button',
    {
      class: 'btn',
      type: 'button',
      onClick: async () => {
        setActiveWorkspaceId(null);
        await signOut();
        window.location.replace('./login.html');
      },
    },
    'Sign out',
  );
}

function showError(message) {
  replaceChildren(
    root(),
    el(
      'main',
      { id: 'main-content', class: 'app-main' },
      el(
        'div',
        { class: 'page stack' },
        el('div', { class: 'alert alert--danger' }, message),
        el(
          'button',
          { class: 'btn', type: 'button', onClick: () => window.location.reload() },
          'Reload',
        ),
      ),
    ),
  );
  announce(message, 'assertive');
}

function showLoading(label = 'Loading your ledger') {
  replaceChildren(
    root(),
    el(
      'main',
      { id: 'main-content', class: 'app-main' },
      el(
        'div',
        { class: 'page stack' },
        el('div', { class: 'skeleton', style: { height: '32px', width: '240px' } }),
        el(
          'div',
          { class: 'grid grid--summary' },
          el('div', { class: 'skeleton', style: { height: '96px' } }),
          el('div', { class: 'skeleton', style: { height: '96px' } }),
          el('div', { class: 'skeleton', style: { height: '96px' } }),
          el('div', { class: 'skeleton', style: { height: '96px' } }),
        ),
        el('p', { class: 'sr-only', role: 'status' }, label),
      ),
    ),
  );
}

/* -------------------------------------------------------------------------
   Workspace picker
   ------------------------------------------------------------------------- */

function renderWorkspacePicker(workspaces) {
  const user = currentUser();

  const list = workspaces.length
    ? el(
        'div',
        { class: 'stack' },
        ...workspaces.map((workspace) =>
          el(
            'button',
            {
              class: 'card card--interactive',
              type: 'button',
              onClick: () => {
                setActiveWorkspaceId(workspace.workspaceId);
                start();
              },
            },
            el('p', { class: 'card__title' }, workspace.name),
            el(
              'p',
              { class: 'card__meta' },
              `${ROLE_LABEL[workspace.role] ?? workspace.role} · ${workspace.type}`,
            ),
          ),
        ),
      )
    : el(
        'div',
        { class: 'empty-state' },
        el('p', { class: 'u-weight-medium' }, 'You are not in any workspace yet'),
        el(
          'p',
          { class: 'u-text-sm' },
          'Create one to start your ledger, or ask a Super Admin to invite you.',
        ),
      );

  replaceChildren(
    root(),
    el(
      'main',
      { id: 'main-content', class: 'app-main' },
      el(
        'div',
        { class: 'page stack form-page' },
        pageHeader({
          title: 'Choose a workspace',
          subtitle: user?.email ?? '',
          actions: [themeButton(), signOutButton()],
        }),
        list,
        el('hr'),
        renderCreateWorkspaceForm(),
      ),
    ),
  );
}

function renderCreateWorkspaceForm() {
  const state = { name: '', type: 'business' };
  const errorBox = el('div', {});

  const nameInput = el('input', {
    class: 'input',
    id: 'ws-name',
    type: 'text',
    required: true,
    placeholder: 'Patel Traders',
    onInput: (e) => {
      state.name = e.target.value;
    },
  });

  const typeSelect = el(
    'select',
    {
      class: 'select',
      id: 'ws-type',
      onChange: (e) => {
        state.type = e.target.value;
      },
    },
    el('option', { value: 'business' }, 'Small business'),
    el('option', { value: 'family' }, 'Family'),
    el('option', { value: 'personal' }, 'Personal'),
  );

  const submit = el('button', { class: 'btn btn--primary', type: 'submit' }, 'Create workspace');

  async function onSubmit(event) {
    event.preventDefault();
    replaceChildren(errorBox);
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    setText(submit, 'Creating…');

    try {
      await createWorkspace({ name: state.name, type: state.type });
      announce('Workspace created');
      start();
    } catch (error) {
      const message = error?.message ?? 'Could not create the workspace.';
      replaceChildren(errorBox, el('div', { class: 'alert alert--danger' }, message));
      announce(message, 'assertive');
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
      setText(submit, 'Create workspace');
    }
  }

  return el(
    'form',
    { class: 'stack', novalidate: true, onSubmit },
    el('h2', {}, 'Create a workspace'),
    el(
      'p',
      { class: 'u-text-secondary u-text-sm' },
      'You become its Super Admin. Default accounts and categories are set up for you.',
    ),
    el(
      'div',
      { class: 'field' },
      el('label', { class: 'field__label', for: 'ws-name' }, 'Workspace name'),
      nameInput,
    ),
    el(
      'div',
      { class: 'field' },
      el('label', { class: 'field__label', for: 'ws-type' }, 'Type'),
      typeSelect,
    ),
    errorBox,
    submit,
  );
}

/* -------------------------------------------------------------------------
   Dashboard shell
   ------------------------------------------------------------------------- */

async function renderDashboard(workspaceId, membership) {
  const { accounts, categories } = await loadMasterData(workspaceId);
  const today = todayLedgerDate();
  const fy = financialYear(today);
  const user = currentUser();

  const activeAccounts = accounts.filter((a) => a.isActive);
  const incomeCategories = categories.filter((c) => c.type === 'income' && c.isActive);
  const expenseCategories = categories.filter((c) => c.type === 'expense' && c.isActive);

  const firstName = String(membership.displayNameSnapshot ?? '').split(' ')[0];

  replaceChildren(
    root(),
    el(
      'main',
      { id: 'main-content', class: 'app-main' },
      el(
        'div',
        { class: 'page stack stack--loose' },

        pageHeader({
          title: firstName ? `Welcome, ${firstName}` : 'Dashboard',
          subtitle: `${ROLE_LABEL[membership.role] ?? membership.role} · ${formatLedgerDate(today, { style: 'long' })}`,
          actions: [
            el(
              'button',
              {
                class: 'btn',
                type: 'button',
                onClick: () => {
                  setActiveWorkspaceId(null);
                  start();
                },
              },
              'Switch workspace',
            ),
            themeButton(),
            signOutButton(),
          ],
        }),

        el(
          'section',
          { class: 'grid grid--summary', 'aria-label': 'Today' },
          statCard("Today's income", formatPaise(0), 'No entries yet'),
          statCard("Today's expenses", formatPaise(0), 'No entries yet'),
          statCard('Net cash flow', formatPaise(0), 'Income minus expenses'),
          statCard('Financial year', fy.label, `${fy.startDate} to ${fy.endDate}`),
        ),

        el(
          'section',
          { class: 'stack' },
          el('h2', {}, 'Accounts'),
          el(
            'div',
            { class: 'grid grid--summary' },
            ...activeAccounts.map((account) =>
              el(
                'article',
                { class: 'card' },
                el('p', { class: 'u-text-muted u-text-xs' }, account.name),
                el(
                  'p',
                  { class: 'u-text-lg u-weight-semibold tnum' },
                  formatPaise(account.openingBalancePaise ?? 0),
                ),
                el('p', { class: 'card__meta' }, `Opening balance · ${account.type}`),
              ),
            ),
          ),
        ),

        el(
          'section',
          { class: 'stack' },
          el('h2', {}, 'Categories'),
          el(
            'div',
            { class: 'grid grid--halves' },
            categoryList('Income', incomeCategories),
            categoryList('Expense', expenseCategories),
          ),
        ),

        el(
          'section',
          { class: 'stack' },
          el('h2', {}, 'Workspace check'),
          el(
            'dl',
            { class: 'stack stack--tight u-text-sm' },
            defRow('Workspace ID', workspaceId),
            defRow('Your role', ROLE_LABEL[membership.role] ?? membership.role),
            defRow('Signed in as', user?.email ?? ''),
            defRow('Accounts seeded', String(accounts.length)),
            defRow('Categories seeded', String(categories.length)),
            defRow('Base path', basePath + (isProjectSite() ? ' (project site)' : '')),
            defRow('Version', APP.version),
          ),
          el(
            'div',
            { class: 'alert alert--info' },
            'Phase 2 of 10. Entries, transfers and reports arrive in the next phases.',
          ),
        ),
      ),
    ),
  );
}

function categoryList(label, items) {
  return el(
    'article',
    { class: 'card' },
    el('p', { class: 'card__title' }, label),
    el(
      'ul',
      {
        class: 'stack stack--tight u-text-sm',
        style: { 'list-style': 'none', padding: '0', 'margin-top': 'var(--space-3)' },
      },
      ...items.map((category) => el('li', {}, category.name)),
    ),
  );
}

function statCard(label, value, detail) {
  return el(
    'article',
    { class: 'card' },
    el('p', { class: 'u-text-muted u-text-xs' }, label),
    el('p', { class: 'u-text-2xl u-weight-semibold tnum' }, value),
    el('p', { class: 'u-text-muted u-text-xs u-truncate', title: detail }, detail),
  );
}

function defRow(term, value) {
  return el(
    'div',
    { class: 'row row--between u-gap-4' },
    el('dt', { class: 'u-text-muted' }, term),
    el('dd', { class: 'u-truncate', style: { margin: '0' } }, value),
  );
}

/* -------------------------------------------------------------------------
   Boot
   ------------------------------------------------------------------------- */

async function start() {
  showLoading();

  try {
    const user = await waitForAuthReady();

    if (!user) {
      window.location.replace('./login.html');
      return;
    }

    const profile = await getUserProfile(user.uid);
    if (profile?.disabled === true) {
      await signOut();
      window.location.replace('./login.html');
      return;
    }

    const active = await resolveActiveWorkspace();

    if (!active) {
      renderWorkspacePicker(await listMyWorkspaces());
      return;
    }

    await renderDashboard(active.workspaceId, active.membership);
  } catch (error) {
    console.error('[PMExps] Startup failed', error);
    showError(
      error?.message ?? 'Could not load your ledger. Check your connection and reload.',
    );
  }
}

setTheme(getPreference(), { animate: false });
watchSystemTheme();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => start(), { once: true });
} else {
  start();
}
