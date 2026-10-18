/**
 * Scrolling to a section that has not loaded yet (UI-03).
 *
 * The browser scrolls to `#something` when the page loads and gives up if
 * nothing has that id — which is every card on My Settings, because each one
 * fetches before it renders. A member following `#interests` from a Radar
 * digest therefore arrives on the right page, at the top of it, looking at
 * their password form.
 *
 * So: look again for a short while. Bounded, because a hash that never
 * matches is a link to a card this co-op does not have — Radar is on a plan,
 * the Buddy System is a setting — and the honest outcome there is the top of
 * the page rather than a loop.
 */

/** How long to keep looking. Long enough for a fetch, short enough to stop. */
export const GIVE_UP_AFTER_MS = 4_000;

/**
 * Scroll to the element the hash names, once it exists.
 *
 * Returns a cancel function, which the caller must run on unmount: a member
 * who navigates away mid-wait must not be yanked back by a card that
 * finished loading after they left.
 */
export function scrollToHashWhenReady(
  hash: string,
  now: () => number = () => Date.now(),
): () => void {
  const id = (hash ?? '').replace(/^#/, '').trim();
  if (!id || typeof document === 'undefined') return () => undefined;

  const startedAt = now();
  let frame = 0;
  let cancelled = false;

  const look = () => {
    if (cancelled) return;

    const target = document.getElementById(id);
    if (target) {
      target.scrollIntoView({ block: 'start' });
      return;
    }

    if (now() - startedAt < GIVE_UP_AFTER_MS) {
      frame = requestAnimationFrame(look);
    }
  };

  frame = requestAnimationFrame(look);

  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
  };
}
