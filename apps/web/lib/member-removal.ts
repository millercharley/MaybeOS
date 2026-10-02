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

/** w-56 in the markup. Kept here because the maths depends on it. */
export const MENU_WIDTH = 224;
const GAP = 4;
const EDGE = 8;

export type Rect = { top: number; bottom: number; right: number };
export type Viewport = { width: number; height: number };

export function menuPosition(
  rect: Rect,
  viewport: Viewport,
  menuHeight: number,
): { top: number; left: number } {
  // Open upwards when there is not room below — not because it looks better,
  // but because the alternative is a menu the page cannot scroll to.
  const roomBelow = viewport.height - rect.bottom;
  const top =
    roomBelow < menuHeight + GAP + EDGE
      ? Math.max(EDGE, rect.top - menuHeight - GAP)
      : rect.bottom + GAP;

  // Right-aligned to the button, then pulled back inside the window — a menu
  // half off the right edge is the same problem one row up.
  const left = Math.min(
    Math.max(EDGE, rect.right - MENU_WIDTH),
    Math.max(EDGE, viewport.width - MENU_WIDTH - EDGE),
  );

  return { top, left };
}
