'use client';

import { useEffect, useRef } from 'react';
import { needsReveal } from '@/lib/reveal';

/**
 * Bring a panel into view when it opens (UI-04).
 *
 * Attach the ref to the thing that appears; pass whatever identifies *which*
 * thing is open — an id, or a boolean. When that changes to something truthy,
 * the panel is scrolled to and given focus.
 *
 * **Focus goes to the panel, not to its first input.** Focusing an input
 * announces the field instead of the region, and on a phone it throws up the
 * keyboard over the thing somebody was just sent to look at. A container with
 * `tabIndex={-1}` puts a screen reader at the top of the new region and leaves
 * the next Tab in the right place, without hijacking the viewport.
 *
 * **Nothing is cancelled on cleanup, deliberately.** The first version did, and
 * it broke the feature under React's StrictMode: the effect is invoked twice,
 * the cleanup between the two runs cancelled the frame the first had scheduled,
 * and the second saw its own bookkeeping already updated and did nothing. Every
 * scheduled callback below re-reads `ref.current` and does nothing once the
 * panel has gone, so there is nothing to clean up — and an effect whose
 * correctness depends on not being run twice is one that will break again.
 */
export function useReveal<T extends HTMLElement>(key: string | number | boolean | null | undefined) {
  const ref = useRef<T>(null);
  // The key this last acted on. Compared rather than counted, so a second
  // invocation of the same change is a no-op rather than a second scroll.
  const revealed = useRef(key);

  useEffect(() => {
    if (key === revealed.current) return;
    revealed.current = key;
    if (!key) return;

    let done = false;
    const run = () => {
      if (done) return;
      done = true;

      const el = ref.current;
      if (!el) return;

      const scroller = el.closest('main') ?? document.documentElement;
      const scrollerTop =
        scroller === document.documentElement ? 0 : scroller.getBoundingClientRect().top;
      const box = el.getBoundingClientRect();

      if (
        needsReveal(
          { top: box.top - scrollerTop, bottom: box.bottom - scrollerTop },
          scroller.clientHeight,
        )
      ) {
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const before = scroller.scrollTop;

        el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });

        /**
         * Check that it moved, and jump if it did not.
         *
         * `behavior: 'smooth'` is not honoured everywhere — found in a webview
         * where `'auto'` scrolled correctly and `'smooth'` left the page
         * exactly where it was. Trusting the call means the feature quietly
         * does nothing for those users, which is worse than an abrupt jump:
         * the jump still takes them to the thing.
         */
        if (!reduced) {
          setTimeout(() => {
            if (ref.current && scroller.scrollTop === before) {
              el.scrollIntoView({ behavior: 'auto', block: 'start' });
            }
          }, 400);
        }
      }

      // Regardless of whether it scrolled: somebody who opened an editor that
      // was already on screen still wants their keyboard in it.
      el.focus({ preventScroll: true });
    };

    /**
     * A frame if the page is painting, a timeout if it is not.
     *
     * The wait exists because the panel is mounted by the render that flipped
     * this key, so measuring in the effect body measures a position it is about
     * to leave. `requestAnimationFrame` is the right tool for that — except in
     * a document the browser is not painting, where it never fires at all.
     * Found in a hidden tab, where this did nothing and looked like a bug in
     * the hook for several rounds of debugging.
     *
     * Whichever arrives first wins; `done` makes the other a no-op.
     */
    requestAnimationFrame(run);
    setTimeout(run, 50);
  }, [key]);

  return ref;
}
