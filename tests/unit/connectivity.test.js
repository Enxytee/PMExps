/**
 * @vitest-environment jsdom
 *
 * The rule under test: operations that take a voucher number from a counter
 * must refuse to run offline rather than queue. Queuing them would let two
 * devices allocate the same number to different entries.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../js/utils/base-path.js', () => ({
  serviceWorkerConfig: () => ({ scriptUrl: '/service-worker.js', scope: '/' }),
  basePath: '/',
  assetUrl: (p) => `/${p}`,
  absoluteUrl: (p) => `http://localhost/${p}`,
  isProjectSite: () => false,
  getBasePath: () => '/',
}));

const { requireOnline, isOnline, onConnectivityChange, initConnectivity } = await import(
  '../../js/services/connectivity.js'
);

/** @param {boolean} value */
function setNavigatorOnline(value) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
  window.dispatchEvent(new window.Event(value ? 'online' : 'offline'));
}

beforeEach(() => {
  document.body.innerHTML =
    '<div id="sr-status" role="status"></div><div id="sr-alerts" role="alert"></div>';
  setNavigatorOnline(true);
});

describe('requireOnline', () => {
  it('permits the operation when online', () => {
    initConnectivity();
    setNavigatorOnline(true);
    expect(() => requireOnline('Confirming an entry')).not.toThrow();
  });

  it('refuses when offline, naming the operation', () => {
    initConnectivity();
    setNavigatorOnline(false);
    expect(() => requireOnline('Confirming an entry')).toThrow(/Confirming an entry/);
  });

  it('explains what the person should do, not only what failed', () => {
    initConnectivity();
    setNavigatorOnline(false);
    try {
      requireOnline('Recording a transfer');
    } catch (error) {
      expect(error.message).toMatch(/drafts are saved/i);
      expect(error.message).toMatch(/try again/i);
    }
  });
});

describe('connectivity state', () => {
  it('reports and announces changes', () => {
    initConnectivity();
    const seen = [];
    onConnectivityChange((value) => seen.push(value));

    setNavigatorOnline(false);
    setNavigatorOnline(true);

    // First call is immediate with the current state, then each change.
    expect(seen).toEqual([true, false, true]);
    expect(isOnline()).toBe(true);
  });

  it('shows a banner offline and removes it online', () => {
    initConnectivity();

    setNavigatorOnline(false);
    const banner = document.querySelector('#offline-banner');
    expect(banner).not.toBeNull();
    // The words carry the meaning; colour is not the only signal.
    expect(banner.textContent).toMatch(/offline/i);
    expect(banner.textContent).toMatch(/drafts/i);

    setNavigatorOnline(true);
    expect(document.querySelector('#offline-banner')).toBeNull();
  });

  it('does not stack banners if offline fires twice', () => {
    initConnectivity();
    setNavigatorOnline(false);
    window.dispatchEvent(new window.Event('offline'));
    expect(document.querySelectorAll('#offline-banner')).toHaveLength(1);
  });
});
