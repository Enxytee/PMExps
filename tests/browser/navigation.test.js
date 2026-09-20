/**
 * PMExps — Navigation
 *
 * @vitest-environment jsdom
 *
 * These tests exist because a Back button did nothing at all, twice, and no
 * amount of reading the code made that obvious. The print view replaces the
 * whole of #app, and renderPage() then had nowhere to draw into and returned
 * silently — no error, no navigation, nothing in the console.
 *
 * So this exercises the actual sequence: render the shell, wipe it the way
 * the print view does, navigate back, and assert that a real page appears in
 * a real DOM.
 *
 * Firebase is mocked because none of this touches the network.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---- Mocks ----------------------------------------------------------------
// The shell imports state, which imports the workspace service, which imports
// the Firebase SDK. None of that is involved in navigation.

vi.mock('../../js/firebase/init.js', () => ({
  db: {},
  auth: {},
  storage: {},
  firestore: {},
  authApi: {},
  storageApi: {},
  usingEmulators: false,
}));

vi.mock('../../js/services/auth.js', () => ({
  currentUser: () => ({ uid: 'u1', displayName: 'Test', email: 't@test.local' }),
  signOut: vi.fn(),
  getUserProfile: vi.fn(),
  waitForAuthReady: vi.fn(),
}));

vi.mock('../../js/services/workspaces.js', () => ({
  loadMasterData: vi.fn(async () => ({ accounts: [], categories: [] })),
  setActiveWorkspaceId: vi.fn(),
  listMyWorkspaces: vi.fn(),
  resolveActiveWorkspace: vi.fn(),
  createWorkspace: vi.fn(),
  getMembership: vi.fn(),
  loadWorkspaceDetails: vi.fn(),
  saveWorkspaceDetails: vi.fn(),
}));

const { buildShell, renderPage, pageHeader, refreshNavState } = await import(
  '../../js/components/shell.js'
);
const { defineRoutes, navigate, resolve, currentPath } = await import('../../js/router.js');
const { setContext } = await import('../../js/state.js');
const { el, qs } = await import('../../js/utils/dom.js');

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  window.location.hash = '';
  setContext({
    user: { uid: 'u1' },
    workspaceId: 'ws1',
    membership: { role: 'superAdmin', displayNameSnapshot: 'Test' },
  });
});

describe('the app shell', () => {
  it('builds the navigation frame', () => {
    buildShell();
    expect(qs('.app-sidebar')).not.toBeNull();
    expect(qs('#main-content')).not.toBeNull();
  });

  it('renders a page into the frame', () => {
    buildShell();
    renderPage(pageHeader({ title: 'Daily ledger' }));
    expect(qs('#main-content h1')?.textContent).toBe('Daily ledger');
  });

  it('rebuilds the frame after the print view has replaced #app', () => {
    // 1. Normal state.
    buildShell();
    renderPage(pageHeader({ title: 'Daily ledger' }));
    expect(qs('.app-sidebar')).not.toBeNull();

    // 2. The print view replaces everything, navigation included. This is
    //    exactly what views/print-daily.js does.
    qs('#app').replaceChildren(el('article', { class: 'a4-sheet' }, 'printed page'));
    expect(qs('.app-sidebar')).toBeNull();
    expect(qs('#main-content')).toBeNull();

    // 3. Back. This is the step that silently did nothing before.
    renderPage(pageHeader({ title: 'Daily ledger' }));

    expect(qs('.app-sidebar'), 'sidebar should be restored').not.toBeNull();
    expect(qs('#main-content h1')?.textContent).toBe('Daily ledger');
    expect(qs('.a4-sheet'), 'printed sheet should be gone').toBeNull();
  });

  it('refreshNavState does not throw when the frame is missing', () => {
    qs('#app').replaceChildren(el('div', {}, 'no frame here'));
    expect(() => refreshNavState()).not.toThrow();
  });
});

describe('routing back from the print view', () => {
  /** Records which route rendered, so the assertions are about behaviour. */
  let rendered = [];

  beforeEach(() => {
    rendered = [];
    defineRoutes([
      {
        path: '/ledger',
        title: 'Daily ledger',
        render: (context) => {
          rendered.push({ path: '/ledger', date: context.query.get('date') });
          renderPage(pageHeader({ title: 'Daily ledger' }));
        },
      },
      {
        path: '/print/daily',
        title: 'Print',
        render: (context) => {
          rendered.push({ path: '/print/daily', date: context.query.get('date') });
          // Mirrors the real print view: replaces the entire app container.
          qs('#app').replaceChildren(
            el('article', { class: 'a4-sheet' }, 'printed page'),
          );
        },
      },
    ]);
  });

  it('matches the print route and its date parameter', async () => {
    window.location.hash = '#/print/daily?date=2026-09-17';
    await resolve();

    expect(rendered).toEqual([{ path: '/print/daily', date: '2026-09-17' }]);
    expect(qs('.a4-sheet')).not.toBeNull();
  });

  it('goes back to the ledger and shows it', async () => {
    // Start on the print page.
    window.location.hash = '#/print/daily?date=2026-09-17';
    await resolve();
    expect(qs('.a4-sheet')).not.toBeNull();

    // Press Back. The real button calls navigate() with this exact path.
    navigate('/ledger?date=2026-09-17');
    expect(currentPath()).toBe('/ledger');

    // jsdom does not run the hashchange listener synchronously here, so the
    // router is resolved directly — which is what the listener does.
    await resolve();

    expect(rendered[1]).toEqual({ path: '/ledger', date: '2026-09-17' });
    expect(qs('.a4-sheet'), 'printed page should be replaced').toBeNull();
    expect(qs('.app-sidebar'), 'navigation should be back').not.toBeNull();
    expect(qs('#main-content h1')?.textContent).toBe('Daily ledger');
  });

  it('survives going to print and back repeatedly', async () => {
    for (let i = 0; i < 3; i += 1) {
      window.location.hash = '#/print/daily?date=2026-09-17';
      await resolve();
      expect(qs('.a4-sheet')).not.toBeNull();

      navigate('/ledger?date=2026-09-17');
      await resolve();
      expect(qs('#main-content h1')?.textContent).toBe('Daily ledger');
    }
  });

  it('the hashchange listener drives the same path', async () => {
    const { startRouter } = await import('../../js/router.js');
    await startRouter();

    window.location.hash = '#/print/daily?date=2026-09-17';
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    await new Promise((r) => setTimeout(r, 0));
    expect(qs('.a4-sheet')).not.toBeNull();

    window.location.hash = '#/ledger?date=2026-09-17';
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    await new Promise((r) => setTimeout(r, 0));

    expect(qs('.app-sidebar')).not.toBeNull();
    expect(qs('#main-content h1')?.textContent).toBe('Daily ledger');
  });
});
