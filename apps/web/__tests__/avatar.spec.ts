import { readFileSync } from 'fs';
import { join } from 'path';
import { popoverPosition } from '@/lib/popover';

const strip = (s: string) =>
  s.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const read = (...p: string[]) => strip(readFileSync(join(__dirname, '..', ...p), 'utf8'));

/**
 * Faces in the Commons (CMN-23).
 *
 * Charley: "the avatar images are not loading in the Commons." They were
 * never asked for — every circle rendered the first letter of a name and
 * nothing else, while the same person's photograph showed on their profile.
 * A thing that was never built looked exactly like a thing that was broken.
 */
describe('the avatar', () => {
  const avatar = read('components', 'member', 'avatar.tsx');

  it('shows the photograph when there is one', () => {
    expect(avatar).toMatch(/if \(avatarUrl\)/);
    expect(avatar).toMatch(/<img/);
  });

  it('falls back to an initial rather than a broken image', () => {
    expect(avatar).toMatch(/charAt\(0\)\.toUpperCase\(\) \|\| '\?'/);
  });

  it('uppercases a name that was typed in lower case', () => {
    // "andrew kang bartlett" — a lower-case letter alone in a circle reads as
    // a glyph rather than as a person.
    expect(avatar).toMatch(/\.toUpperCase\(\)/);
  });
});

describe('where the Commons uses it', () => {
  const portal = read('app', '(app)', 'portal', '[orgSlug]', 'commons', 'page.tsx');
  const admin = read('app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'commons', 'page.tsx');

  it('on a post, in both Commons', () => {
    expect(portal).toMatch(/<Avatar name=\{post\.author\?\.name\} avatarUrl=\{post\.author\?\.avatarUrl\}/);
    expect(admin).toMatch(/<Avatar name=\{authorName\} avatarUrl=\{post\.author\?\.avatarUrl\}/);
  });

  it('on a comment', () => {
    expect(admin).toMatch(/<Avatar name=\{comment\.author\?\.name\} avatarUrl=\{comment\.author\?\.avatarUrl\}/);
  });

  it('leaves no hand-rolled initial circles behind', () => {
    // Six copies of this pattern is how they start disagreeing about the
    // fallback.
    expect(portal).not.toMatch(/post\.author\?\.name\?\.charAt\(0\)/);
    expect(admin).not.toMatch(/comment\.author\.name \?\? '\?'\)\.charAt\(0\)/);
  });
});

/**
 * And where a floating panel goes (CMN-22).
 *
 * Charley: "emoji picker is cutoff." It was `absolute` inside the bar, so the
 * post card clipped it — the same mistake the row menu made and fixed in
 * UI-02, which is why the arithmetic now lives in one place.
 */
describe('placing a popover', () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 224, height: 212 };

  it('opens below the button when there is room', () => {
    const at = popoverPosition({ top: 100, bottom: 120, left: 50, right: 80 }, viewport, size);
    expect(at.top).toBe(124);
  });

  it('opens above when there is not', () => {
    // Rather than into space the page will not scroll to.
    const at = popoverPosition({ top: 740, bottom: 770, left: 50, right: 80 }, viewport, size);
    expect(at.top).toBe(740 - size.height - 4);
  });

  it('never goes off the top, even when neither side fits', () => {
    const at = popoverPosition({ top: 10, bottom: 790, left: 50, right: 80 }, viewport, size);
    expect(at.top).toBeGreaterThanOrEqual(8);
  });

  it('pulls back inside the right edge', () => {
    const at = popoverPosition({ top: 100, bottom: 120, left: 960, right: 990 }, viewport, size);
    expect(at.left + size.width).toBeLessThanOrEqual(viewport.width);
  });

  it('aligns right when asked, which is what the row menu wants', () => {
    const at = popoverPosition({ top: 100, bottom: 120, left: 500, right: 600 }, viewport, size, 'right');
    expect(at.left).toBe(600 - size.width);
  });
});

describe('the picker that was cut off', () => {
  const bar = read('components', 'reactions', 'reaction-bar.tsx');

  it('is positioned against the viewport, not inside the card', () => {
    /*
      A post card and the channel feed both scroll, and an absolutely
      positioned child is clipped by either. Verified in a browser: the panel
      computes `position: fixed`, sits fully on screen, and no ancestor
      creates a containing block that could bring the clipping back.
    */
    expect(bar).toMatch(/className="fixed z-50/);
    expect(bar).toMatch(/popoverPosition\(/);
    expect(bar).not.toMatch(/absolute bottom-full/);
  });

  it('measures the button it opens from', () => {
    expect(bar).toMatch(/getBoundingClientRect\(\)/);
  });
});
