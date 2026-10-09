import { readFileSync } from 'fs';
import { join } from 'path';
import { MENU_WIDTH, menuPosition, payingDues } from '@/lib/member-removal';

/**
 * Removing a member from the Members page (MEM-20).
 *
 * The kebab menu on this page had no click handler at all — it rendered three
 * dots and did nothing. That is the only reason nobody had met the bug
 * underneath it: the removal endpoint deleted the membership and never told
 * Stripe, so a removed member kept being billed and the row holding their
 * subscription id was gone.
 */

describe('who is warned that their dues stop today', () => {
  it('warns for a subscription Stripe would charge again', () => {
    for (const subscriptionStatus of ['ACTIVE', 'TRIALING', 'PAST_DUE', 'UNPAID', 'INCOMPLETE']) {
      expect(payingDues({ subscriptionStatus })).toBe(true);
    }
  });

  it('stays quiet for somebody who is not paying', () => {
    // A warning that appears on every member is a warning nobody reads, and
    // this one is the difference between tidying a roster and taking money.
    expect(payingDues({ subscriptionStatus: 'CANCELED' })).toBe(false);
    expect(payingDues({ subscriptionStatus: 'NONE' })).toBe(false);
    expect(payingDues({ subscriptionStatus: null })).toBe(false);
    expect(payingDues({})).toBe(false);
  });

  it('does not care how the status was cased', () => {
    expect(payingDues({ subscriptionStatus: 'active' })).toBe(true);
  });
});

/**
 * A rect shaped like the one the browser hands us.
 *
 * jsdom has no DOMRect, and a plain object literal is not a substitute: a real
 * DOMRect keeps its numbers in accessors on the prototype, so it has no own
 * enumerable keys at all. Code that spreads one gets `{}` and every number
 * downstream turns to NaN.
 *
 * That is not hypothetical. `menuPosition` spread its argument for a while and
 * these very tests stayed green, because they passed literals. Charley found
 * it instead: the row menu opened at the top-left of the page, about ten rows
 * above the row he had clicked.
 */
function domRect({ top, bottom, right }: { top: number; bottom: number; right: number }) {
  const proto = {
    get top() { return top; },
    get bottom() { return bottom; },
    get right() { return right; },
    get left() { return 0; },
  };
  return Object.create(proto) as { top: number; bottom: number; right: number };
}

describe('a rect from the browser', () => {
  it('has nothing to spread, which is the whole trap', () => {
    const r = domRect({ top: 100, bottom: 124, right: 1200 });

    expect(Object.keys(r)).toEqual([]);
    expect({ ...r }).toEqual({});
    // Reading it directly is fine; only copying it loses everything.
    expect(r.right).toBe(1200);
  });
});

describe('where the menu is drawn', () => {
  const viewport = { width: 1280, height: 800 };
  const button = (top: number) => domRect({ top, bottom: top + 24, right: 1200 });

  it('survives a rect it cannot spread', () => {
    /*
      The regression itself. Every number has to be finite — a NaN reaches the
      DOM as `NaNpx`, which the browser drops, and a `fixed` element with no
      top or left falls back to its static position instead of staying put.
    */
    const { top, left } = menuPosition(button(300), viewport, 84);

    expect(Number.isFinite(top)).toBe(true);
    expect(Number.isFinite(left)).toBe(true);
  });

  it('opens below the button when there is room', () => {
    expect(menuPosition(button(300), viewport, 44).top).toBe(328);
  });

  it('opens upwards on the last row rather than off the bottom', () => {
    // The last row of a full roster is exactly the row somebody tidying up
    // reaches for, and the page will not scroll to a menu below the fold.
    const { top } = menuPosition(button(760), viewport, 44);

    expect(top).toBe(760 - 44 - 4);
    expect(top).toBeGreaterThanOrEqual(8);
  });

  it('never puts the menu above the top of the window', () => {
    expect(menuPosition(domRect({ top: 4, bottom: 10, right: 1200 }), { width: 1280, height: 40 }, 44).top)
      .toBe(8);
  });

  it('right-aligns to the button', () => {
    expect(menuPosition(button(300), viewport, 44).left).toBe(1200 - MENU_WIDTH);
  });

  it('pulls a menu back inside a narrow window', () => {
    const { left } = menuPosition(domRect({ top: 100, bottom: 124, right: 360 }), { width: 375, height: 800 }, 44);

    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + MENU_WIDTH).toBeLessThanOrEqual(375);
  });
});

describe('the table fits without scrolling sideways', () => {
  const page = readFileSync(
    join(__dirname, '..', 'app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'members', 'page.tsx'),
    'utf8',
  );

  it('does not carry a separate Email column', () => {
    // Name and email were two text columns pushing Actions off the screen.
    expect(page).not.toMatch(/>\s*Email\s*<\/th>/);
    expect(page).toMatch(/>\s*Member\s*<\/th>/);
  });

  it('spans the empty-state row across every column that is left', () => {
    expect(page).toMatch(/colSpan=\{7\}/);
  });

  it('truncates the name and email rather than widening the row', () => {
    expect(page).toMatch(/truncate text-sm font-medium text-gray-900/);
    expect(page).toMatch(/truncate text-xs text-gray-500/);
  });

  it('caps the text block so one long email cannot set the row width', () => {
    // An email address is a single unbreakable token, so `truncate` alone
    // does not stop it deciding how wide the column has to be. Measured in a
    // browser: capping it took the table's floor from ~980px to ~858px, and
    // the dashboard renders this page at about 930.
    expect(page).toMatch(/min-w-0 max-w-\[11rem\] overflow-hidden/);
  });

  it('does not spend a column heading on a word wider than its button', () => {
    expect(page).toMatch(/<span className="sr-only">Actions<\/span>/);
  });
});

describe('the menu is wired to something', () => {
  const page = readFileSync(
    join(__dirname, '..', 'app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'members', 'page.tsx'),
    'utf8',
  );

  it('opens on a click', () => {
    // The original button had no onClick. It looked finished.
    expect(page).toMatch(/onClick=\{\(e\) => toggleMenu\(e, member\)\}/);
  });

  it('is drawn against the viewport, not inside the scrolling table', () => {
    // The table lives in an `overflow-x-auto` card, which clips an
    // absolutely-positioned child. That is the bug this replaced.
    expect(page).toMatch(/className="fixed z-50/);
    expect(page).not.toMatch(/absolute right-6 z-20/);
  });

  it('knows how tall it is, so the flip-up maths is not a guess', () => {
    /*
      MENU_HEIGHT said 44 and "one item today" for a while after MEM-27 added
      Edit above Remove. A two-item menu near the foot of the window then
      decided it had room below when it did not, and opened off the bottom.

      Each item is 36px, the container adds 4px of padding and 1px of border
      each side. If a third item lands here, this fails rather than drifting.
    */
    const items = page.match(/role="menuitem"/g) ?? [];
    const declared = Number(page.match(/const MENU_HEIGHT = (\d+)/)?.[1]);

    expect(items).toHaveLength(2);
    expect(declared).toBe(items.length * 36 + 8 + 2 + 2);
  });

  it('is rendered on the body, where no parent margin can move it', () => {
    /*
      It used to render in place, inside a `space-y-6` container — which gives
      every child after the first a 24px top margin. Margin moves a `fixed`
      element like any other, so the menu landed 24px below the row it
      belonged to and the backdrop missed the top 24px of the screen.
    */
    expect(page).toMatch(/createPortal\(/);
    expect(page).toMatch(/document\.body,/);
  });

  it('closes when the page moves under it', () => {
    // A viewport-positioned menu does not travel with its row.
    expect(page).toMatch(/addEventListener\('scroll', close, true\)/);
    expect(page).toMatch(/addEventListener\('resize', close\)/);
  });

  it('closes when the admin clicks elsewhere', () => {
    expect(page).toMatch(/onClick=\{\(\) => setOpenMenu\(null\)\}/);
  });

  it('asks before removing anybody', () => {
    // No remove call may be reachable from the menu item itself.
    expect(page).toMatch(/setConfirmRemove\(openMenu\.member\)/);
    expect(page).toMatch(/api\.members\.remove\(/);
  });

  it('says dues are cancelled immediately and not refunded', () => {
    expect(page).toMatch(/cancelled immediately/);
    expect(page).toMatch(/not\s+refunded/);
  });

  it('says it cannot be undone', () => {
    expect(page).toMatch(/cannot be undone/);
  });

  it('does not use window.confirm', () => {
    // It is suppressed in some browsers, including the one this was tested in,
    // which would make the destructive action silently do nothing.
    expect(page).not.toMatch(/window\.confirm/);
  });

  it('shows the failure rather than leaving the admin guessing', () => {
    expect(page).toMatch(/setRemoveError\(/);
    expect(page).toMatch(/\{removeError\}/);
  });
});
