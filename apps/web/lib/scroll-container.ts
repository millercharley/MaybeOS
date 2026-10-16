/**
 * Which element is actually scrolling (CMN-18).
 *
 * A chat lands on its newest message by writing `scrollTop` on the element
 * holding the conversation. That assumes the element scrolls, and in the
 * Commons it only does from `lg` up: below that breakpoint the pane has a
 * minimum height and no maximum, so it grows to fit every post, and the app
 * shell's `<main>` scrolls instead.
 *
 * Writing `scrollTop` to an element that cannot scroll fails silently — it is
 * accepted and clamped to zero — so on a phone the Commons opened on the
 * *oldest* message with four thousand pixels of history below it, and
 * everything looked correct from the code's point of view.
 *
 * Rather than fix the breakpoint and hope no other layout grows past its
 * container, ask the DOM which element is doing the scrolling and write to
 * that one.
 */

/** Could this element scroll vertically, and does it have anywhere to go? */
function scrolls(el: Element): boolean {
  const overflowY = getComputedStyle(el).overflowY;
  if (overflowY !== 'auto' && overflowY !== 'scroll') return false;
  // An element with `overflow-y: auto` whose content fits is not scrolling,
  // and is exactly the case this exists to see past.
  return el.scrollHeight > el.clientHeight + 1;
}

/**
 * The nearest element that will respond to `scrollTop`, starting at `el`.
 *
 * Returns the document's scrolling element when nothing between `el` and the
 * root is scrolling, because that is what the browser scrolls — and null only
 * when there is no document to ask, which is server rendering.
 */
export function scrollParent(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null;

  let node: Element | null = el;
  while (node && node !== document.body && node !== document.documentElement) {
    if (scrolls(node)) return node as HTMLElement;
    node = node.parentElement;
  }

  // `scrollingElement` is the standards answer and is what browsers scroll;
  // `documentElement` is the same element in standards mode and covers
  // environments that do not implement the newer property.
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** Put the newest content in view, whichever element is doing the scrolling. */
export function scrollToBottom(el: HTMLElement | null): void {
  const scroller = scrollParent(el);
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}
