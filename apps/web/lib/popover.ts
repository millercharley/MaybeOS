/**
 * Where a floating panel goes (UI-02, CMN-22).
 *
 * The row menu learned this first: an absolutely-positioned child is clipped
 * by any scrolling ancestor, and near an edge it opens into space the page
 * will not scroll to. Positioning against the viewport instead takes it out
 * of the clipping container entirely.
 *
 * The reaction picker repeated the mistake — it opened upward from a button
 * near the top of a post card, and the card cut the top rows off — so the
 * arithmetic moved here, where both can share it.
 */

export type Rect = { top: number; bottom: number; left: number; right: number };
export type Viewport = { width: number; height: number };
export type Size = { width: number; height: number };

const GAP = 4;
const EDGE = 8;

/**
 * Below the button when it fits, above when it does not, and never past an
 * edge of the window.
 *
 * `align` is which side of the button the panel lines up with. Clamping
 * happens after, because a panel aligned neatly to a button that is itself
 * near the edge is still half off the screen.
 */
export function popoverPosition(
  rect: Rect,
  viewport: Viewport,
  size: Size,
  align: 'left' | 'right' = 'left',
): { top: number; left: number } {
  const roomBelow = viewport.height - rect.bottom;
  const top =
    roomBelow < size.height + GAP + EDGE
      ? Math.max(EDGE, rect.top - size.height - GAP)
      : rect.bottom + GAP;

  const wanted = align === 'right' ? rect.right - size.width : rect.left;
  const left = Math.min(
    Math.max(EDGE, wanted),
    Math.max(EDGE, viewport.width - size.width - EDGE),
  );

  return { top, left };
}
