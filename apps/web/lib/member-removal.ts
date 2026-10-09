/**
 * What removing a member costs them (MEM-20).
 *
 * The removal cancels dues immediately rather than at the end of the period,
 * and Stripe does not refund the days already paid for. An organiser clicking
 * "remove" to tidy up a roster is not expecting to take money off somebody,
 * so the warning has to appear for exactly the people it applies to — and not
 * for the ones it does not, because a warning that fires on everybody stops
 * being read.
 */

/** Subscription states where Stripe would still charge them again. */
const LIVE_DUES = ['ACTIVE', 'TRIALING', 'PAST_DUE', 'UNPAID', 'INCOMPLETE'];

export function payingDues(member: { subscriptionStatus?: string | null }): boolean {
  const status = member.subscriptionStatus;
  if (!status) return false;
  return LIVE_DUES.includes(status.toUpperCase());
}

/**
 * Where the row menu goes (UI-02).
 *
 * The menu used to be an absolutely-positioned child of the table cell, and
 * the table sits in a horizontally-scrolling container — so the container
 * clipped it. On the last row it also opened downwards off the bottom of the
 * card, into space the page would not scroll to. Both are invisible until
 * somebody tries to use the last row of a full roster, which is the row an
 * admin tidying up reaches for.
 *
 * Positioning it against the viewport instead takes it out of the clipping
 * container entirely; this works out where, given the button's rectangle.
 */

import { popoverPosition } from './popover';

/** w-56 in the markup. Kept here because the maths depends on it. */
export const MENU_WIDTH = 224;

export type Rect = { top: number; bottom: number; right: number };
export type Viewport = { width: number; height: number };

/**
 * The arithmetic now lives in `lib/popover.ts` (CMN-22), because the reaction
 * picker hit the same clipping and the same off-screen edge. This keeps the
 * row menu's own signature — right-aligned, one fixed width — and delegates.
 */
export function menuPosition(
  rect: Rect,
  viewport: Viewport,
  menuHeight: number,
): { top: number; left: number } {
  /*
    Each field is read off `rect` by hand, and that is not a style choice.

    This was `{ ...rect, left: ... }`, and a DOMRect spreads to `{}` — its
    properties are accessors on the prototype, so none of them are own
    enumerable keys. Every number downstream became NaN, React could not write
    `NaNpx`, and the menu lost its `top` and `left` entirely: a `fixed` box with
    neither falls back to its static position, which is the top-left of the
    page. Charley saw it open about ten rows above the row he clicked.

    The unit tests did not catch it because they pass object literals, which
    spread perfectly well. The ones below now pass a rect shaped like the real
    thing.
  */
  return popoverPosition(
    { top: rect.top, bottom: rect.bottom, left: rect.right - MENU_WIDTH, right: rect.right },
    viewport,
    { width: MENU_WIDTH, height: menuHeight },
    'right',
  );
}
