'use client';

import { useEffect, useRef } from 'react';
import styles from './landing.module.css';

/**
 * The scrolling list of things MaybeOS retires.
 *
 * Each name is crossed out only when it reaches the left edge, beside
 * "Retire", so a reader has the whole trip across the screen to read it first
 * (Charley, 2026-09-15). Driven by position, not a timer: a timer strikes
 * names before anybody has read them, and it cannot know where each one is.
 *
 * The list is drawn twice so the loop is seamless. When the loop restarts,
 * each copy jumps back to its starting place, where it takes over from the
 * copy that was just there. Those jumps change state without the strike
 * animation, so the handover cannot be seen.
 */
export function RetireTicker({ items }: { items: string[] }) {
  const viewport = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const view = viewport.current;
    if (!view) return;

    const words = Array.from(view.querySelectorAll<HTMLElement>('[data-retire]'));

    // With reduced motion the list sits still and wraps, so everything is
    // crossed out from the start.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      words.forEach((w) => (w.dataset.struck = 'true'));
      return;
    }

    /** How far past the left edge, in pixels, a name has to travel before it is struck. */
    const EDGE = 12;
    const lastLeft = new Map<HTMLElement, number>();
    let frame = 0;

    const tick = () => {
      const edge = view.getBoundingClientRect().left + EDGE;
      for (const word of words) {
        const left = word.getBoundingClientRect().left;
        const previous = lastLeft.get(word);
        lastLeft.set(word, left);

        const shouldStrike = left <= edge;
        const struck = word.dataset.struck === 'true';
        if (shouldStrike === struck) continue;

        // A name that jumped (the loop restarting) changes state instantly;
        // one that drifted across the edge draws its line.
        const jumped = previous !== undefined && Math.abs(left - previous) > 40;
        word.dataset.instant = jumped || !shouldStrike ? 'true' : 'false';
        word.dataset.struck = shouldStrike ? 'true' : 'false';
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className={`${styles.marquee} flex items-center gap-6 overflow-hidden`}>
      <p className="shrink-0 pl-6 font-mono text-xs uppercase tracking-[0.2em] text-paper/60">Retire</p>
      <div ref={viewport} className="relative min-w-0 flex-1 overflow-hidden">
        <div className={styles.marqueeTrack}>
          {[0, 1].map((copy) => (
            <ul key={copy} className="flex shrink-0 items-center gap-10 pr-10" aria-hidden={copy === 1}>
              {items.map((thing) => (
                <li key={thing} className="font-display text-lg text-paper">
                  <span data-retire="" data-struck="false" className={styles.struck}>
                    {thing}
                  </span>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </div>
  );
}
