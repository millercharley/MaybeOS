/**
 * Deciding whether something needs scrolling into view (UI-04).
 *
 * Charley: when an action opens an editor, take the user to it. Two cases he
 * named, and they scroll in opposite directions — a member selecting a room
 * reveals the booking panel *below* the list, an admin pressing Edit reveals
 * the form *above* it — which is why this is a shared rule rather than two
 * fixes. Either way the page silently changed somewhere the person was not
 * looking, and they are left to work out where.
 *
 * Separated from the DOM work so the decision can be tested. The rule that
 * matters is the one about *not* scrolling: a page that jumps when nothing
 * needed to move reads as a glitch rather than as help.
 */

export interface Bounds {
  /** The element, relative to the scrolling viewport's top. */
  top: number;
  bottom: number;
}

/**
 * Whether the element needs bringing into view.
 *
 * The question is only ever about the **top edge**. What somebody needs is to
 * see the thing appear and to see where it starts; if its top is on screen
 * they have that, and they can scroll the rest at their own pace. If its top
 * is off screen — above, because the editor opened higher up the page, or
 * below, because it opened under a long list — they saw nothing happen.
 *
 * An earlier version also scrolled when the *bottom* was cut off, which is
 * wrong and its own test caught it: a panel ending five pixels past the fold
 * is a panel you can see. It would have pulled the page for nothing on almost
 * every long form.
 *
 * `minVisible` keeps a panel that technically begins on screen but only just —
 * a sliver at the bottom edge is not "you can see it appeared".
 */
export function needsReveal(
  el: Bounds,
  viewportHeight: number,
  { margin = 8, minVisible = 96 }: { margin?: number; minVisible?: number } = {},
): boolean {
  if (el.top < margin) {
    // Starts above the fold. Fine only if it starts *at* the top because it is
    // taller than the screen and already open there.
    return el.top < -margin;
  }

  // Starts below the fold, or so near the bottom that nothing useful shows.
  return el.top > viewportHeight - minVisible;
}
