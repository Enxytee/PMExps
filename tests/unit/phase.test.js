/**
 * The build-progress banner.
 *
 * This exists because the banner was hard-coded in a view and shipped stale
 * three times: the code was a phase ahead of what the page claimed. Trivial
 * on its own, but a screen that misdescribes itself teaches people not to
 * trust what it says about their money either.
 */
import { describe, it, expect } from 'vitest';
import { BUILD_PHASE, phaseBanner, APP } from '../../js/config/constants.js';

describe('build phase', () => {
  it('is a real phase within the plan', () => {
    expect(Number.isInteger(BUILD_PHASE.current)).toBe(true);
    expect(BUILD_PHASE.current).toBeGreaterThanOrEqual(1);
    expect(BUILD_PHASE.current).toBeLessThanOrEqual(BUILD_PHASE.total);
  });

  it('builds a sentence that names the phase', () => {
    const banner = phaseBanner();
    expect(banner).toContain(`Phase ${BUILD_PHASE.current} of ${BUILD_PHASE.total}`);
    expect(banner.endsWith('.')).toBe(true);
  });

  it('describes what the phase actually delivered', () => {
    expect(BUILD_PHASE.note.length).toBeGreaterThan(20);
    // A note left over from a previous phase is the exact failure this
    // guards against, so it must not name a different phase number.
    expect(BUILD_PHASE.note).not.toMatch(/Phase \d/);
  });

  it('keeps the app identity stable', () => {
    expect(APP.name).toBe('PMExps');
  });
});
