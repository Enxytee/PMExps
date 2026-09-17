/**
 * PMExps — Application entry point
 *
 * Boots the session, resolves the workspace, registers routes and starts the
 * router. Screens live in js/views; this file only decides who gets in.
 *
 * @module app
 */

import { el, qs, replaceChildren, announce } from './utils/dom.js';
import { defineRoutes, startRouter, setOnNavigate, setGuard, navigate } from './router.js';
import { buildShell, renderPage, pageHeader, refreshNavState } from './components/shell.js';
import { setTheme, getPreference, watchSystemTheme } from './services/theme.js';
import { waitForAuthReady, signOut, getUserProfile } from './services/auth.js';
import {
  resolveActiveWorkspace,
  listMyWorkspaces,
  setActiveWorkspaceId,
  createWorkspace,
} from './services/workspaces.js';
import { setContext, getState } from './state.js';
import { ROLE } from './config/constants.js';
import { renderDashboard, renderLedger, renderDrafts } from './views/ledger.js';
import { renderEntryForm } from './views/entry-form.js';
import { renderSettings } from './views/settings.js';
import { renderTransfer } from './views/transfer.js';
import { renderAudit } from './views/audit.js';
import { renderCorrections, renderCorrectionRequest } from './views/corrections.js';
import { field, textInput, select, setBusy, setFormError } from './components/ui.js';

/* -------------------------------------------------------------------------
   Pre-shell screens
   These render into #app directly, because the navigation frame would be
   meaningless before a workspace is chosen.
   ------------------------------------------------------------------------- */

function fullPage(...children) {
  replaceChildren(
    qs('#app'),
    el('main', { id: 'main-content', class: 'app-main' }, el('div', { class: 'page stack form-page' }, ...children)),
  );
}

function showLoading() {
  replaceChildren(
    qs('#app'),
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
        el('p', { class: 'sr-only', role: 'status' }, 'Loading your ledger'),
      ),
    ),
  );
}

/** @param {string} message */
function showError(message) {
  fullPage(
    el('h1', {}, 'Something went wrong'),
    el('div', { class: 'alert alert--danger' }, message),
    el('button', { class: 'btn', type: 'button', onClick: () => window.location.reload() }, 'Reload'),
  );
  announce(message, 'assertive');
}

/** @param {any[]} workspaces */
function renderWorkspacePicker(workspaces) {
  const { user } = getState();

  fullPage(
    el('h1', {}, 'Choose a workspace'),
    el('p', { class: 'u-text-secondary u-text-sm' }, user?.email ?? ''),

    workspaces.length
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
                  boot();
                },
              },
              el('p', { class: 'card__title' }, workspace.name),
              el('p', { class: 'card__meta' }, `${workspace.role} · ${workspace.type}`),
            ),
          ),
        )
      : el(
          'div',
          { class: 'empty-state' },
          el('p', { class: 'u-weight-medium' }, 'You are not in any workspace yet'),
          el('p', { class: 'u-text-sm' }, 'Create one below, or ask a Super Admin to invite you.'),
        ),

    el('hr'),
    createWorkspaceForm(),
    el(
      'button',
      {
        class: 'btn btn--ghost',
        type: 'button',
        onClick: async () => {
          setActiveWorkspaceId(null);
          await signOut();
          window.location.replace('./login.html');
        },
      },
      'Sign out',
    ),
  );
}

function createWorkspaceForm() {
  const form = { name: '', type: 'business' };
  const errorBox = el('div', {});
  const submit = el('button', { class: 'btn btn--primary', type: 'submit' }, 'Create workspace');

  async function onSubmit(event) {
    event.preventDefault();
    setFormError(errorBox, null);
    const restore = setBusy(submit, 'Creating…');
    try {
      await createWorkspace({ name: form.name, type: form.type });
      boot();
    } catch (error) {
      setFormError(errorBox, error?.message ?? 'Could not create the workspace.');
      restore();
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
    field({
      label: 'Workspace name',
      required: true,
      control: textInput({ placeholder: 'Patel Traders', onInput: (value) => { form.name = value; } }),
    }),
    field({
      label: 'Type',
      control: select({
        value: form.type,
        options: [
          { value: 'business', label: 'Small business' },
          { value: 'family', label: 'Family' },
          { value: 'personal', label: 'Personal' },
        ],
        onChange: (value) => { form.type = value; },
      }),
    }),
    errorBox,
    submit,
  );
}

/* -------------------------------------------------------------------------
   Routes
   ------------------------------------------------------------------------- */

function registerRoutes() {
  defineRoutes([
    { path: '/', title: 'Dashboard', render: renderDashboard },
    { path: '/ledger', title: 'Daily ledger', render: renderLedger },
    { path: '/drafts', title: 'Drafts', render: renderDrafts, writer: true },
    { path: '/entry/new', title: 'Add entry', render: renderEntryForm, writer: true },
    { path: '/entry/:entryId', title: 'Edit entry', render: renderEntryForm, writer: true },
    { path: '/transfer', title: 'Transfer', render: renderTransfer, writer: true },
    { path: '/corrections', title: 'Corrections', render: renderCorrections },
    { path: '/correct/:entryId', title: 'Request correction', render: renderCorrectionRequest, writer: true },
    { path: '/audit', title: 'Audit log', render: renderAudit },
    { path: '/settings', title: 'Settings', render: renderSettings },
    {
      path: '/404',
      title: 'Not found',
      render: () =>
        renderPage(
          pageHeader({ title: 'Page not found' }),
          el('div', { class: 'alert alert--warning' }, 'That page does not exist in PMExps.'),
          el('button', { class: 'btn', type: 'button', onClick: () => navigate('/') }, 'Go to dashboard'),
        ),
    },
  ]);

  // Routes that write need a role that may write. The check is repeated in
  // Firestore rules, so this only saves the user from a form that would fail.
  setGuard((context, route) => {
    if (!route.writer) return true;
    const { role } = getState();
    if (role === ROLE.SUPER_ADMIN || role === ROLE.ACCOUNTANT) return true;

    renderPage(
      pageHeader({ title: 'Not available to you' }),
      el(
        'div',
        { class: 'alert alert--info' },
        'Your role can view the ledger and reports, but not create entries. Ask a Super Admin if this looks wrong.',
      ),
      el('button', { class: 'btn', type: 'button', onClick: () => navigate('/') }, 'Back to dashboard'),
    );
    return false;
  });

  setOnNavigate(refreshNavState);
}

/* -------------------------------------------------------------------------
   Boot
   ------------------------------------------------------------------------- */

async function boot() {
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
      setContext({ user, workspaceId: null, membership: null });
      renderWorkspacePicker(await listMyWorkspaces());
      return;
    }

    setContext({ user, workspaceId: active.workspaceId, membership: active.membership });

    buildShell();
    registerRoutes();
    await startRouter();
  } catch (error) {
    console.error('[PMExps] Startup failed', error);
    showError(error?.message ?? 'Could not load your ledger. Check your connection and reload.');
  }
}

setTheme(getPreference(), { animate: false });
watchSystemTheme();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
} else {
  boot();
}
