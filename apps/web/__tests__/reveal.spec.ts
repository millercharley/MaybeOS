import { needsReveal } from '@/lib/reveal';

/**
 * When an editor opens somewhere the user was not looking (UI-04).
 *
 * The interesting assertions are the ones that say *not* to scroll. Bringing
 * something into view is easy; the way this feature goes wrong is by yanking a
 * page that did not need to move, which reads as a glitch rather than as help.
 */
const VIEW = 800;

describe('deciding whether to scroll', () => {
  it('leaves a panel that is already fully visible alone', () => {
    expect(needsReveal({ top: 200, bottom: 500 }, VIEW)).toBe(false);
  });

  it('reveals a panel below the fold — the member booking case', () => {
    // Selecting a room opens the booking form under a list of rooms.
    expect(needsReveal({ top: 950, bottom: 1400 }, VIEW)).toBe(true);
  });

  it('reveals a panel above the fold — the admin edit case', () => {
    // Pressing Edit on the eighth room opens the form at the top of the page.
    expect(needsReveal({ top: -600, bottom: -100 }, VIEW)).toBe(true);
  });

  it('leaves a panel alone when its bottom is cut off but its start is visible', () => {
    // The user can see it appeared and can scroll the rest themselves. An
    // earlier version scrolled here, which would have pulled the page for
    // nothing on almost every long form.
    expect(needsReveal({ top: 600, bottom: 1100 }, VIEW)).toBe(false);
  });

  it('reveals a panel that begins in the last sliver of the screen', () => {
    // Technically on screen, practically invisible.
    expect(needsReveal({ top: 780, bottom: 1200 }, VIEW)).toBe(true);
  });

  it('leaves a tall panel alone when its start is already at the top', () => {
    // Taller than the screen and beginning where somebody is already reading.
    // Aligning it exactly would move the text under their eyes for nothing.
    expect(needsReveal({ top: 4, bottom: 2000 }, VIEW)).toBe(false);
  });

  it('still reveals a tall panel whose start has scrolled off', () => {
    expect(needsReveal({ top: -300, bottom: 2000 }, VIEW)).toBe(true);
  });

  it('does not fuss over a few pixels', () => {
    // A panel flush against the bottom edge is visible enough.
    expect(needsReveal({ top: 100, bottom: 795 }, VIEW)).toBe(false);
  });

  it('leaves a panel alone that opens exactly where the user clicked', () => {
    // The common case, and the one where scrolling is pure noise.
    expect(needsReveal({ top: 300, bottom: 420 }, VIEW)).toBe(false);
  });
});
