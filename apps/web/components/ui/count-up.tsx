'use client';

import { useEffect, useRef, useState } from 'react';
import { ROLL_MS, decimalsOf, frameValue, shouldAnimate } from '@/lib/count-up';

/**
 * A number that rolls to its new value, with a brief highlight.
 *
 * `requestAnimationFrame` rather than an interval, so the roll runs at the
 * display's rate and stops when the tab is hidden — an interval keeps
 * counting in a background tab and lands the number before anybody sees it
 * move.
 *
 * **Honours `prefers-reduced-motion`.** Somebody who has told their system
 * they do not want motion has outranked the delight, and a dashboard figure
 * animating anyway is the kind of thing that makes people stop using a
 * product rather than complain about it.
 */
export function CountUp({
  value,
  className = '',
}: {
  value: number;
  className?: string;
}) {
  const [shown, setShown] = useState(value);
  const [lit, setLit] = useState(false);
  const previous = useRef<number | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const from = previous.current;
    previous.current = value;

    if (!shouldAnimate(from, value, Boolean(reduced))) {
      setShown(value);
      return;
    }

    const start = from ?? 0;
    const decimals = Math.max(decimalsOf(start), decimalsOf(value));
    const began = performance.now();

    // Only light up a *change*, not the first arrival: highlighting every
    // page load trains people to ignore the highlight, which is the one thing
    // it must not do.
    if (from !== null) {
      setLit(true);
      window.setTimeout(() => setLit(false), ROLL_MS + 400);
    }

    const step = (now: number) => {
      const progress = (now - began) / ROLL_MS;
      setShown(frameValue(start, value, progress, decimals));
      if (progress < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [value]);

  return (
    <span
      // The live value is announced once it settles rather than on every
      // frame: a screen reader reading four hundred numbers is not delight.
      aria-live="polite"
      aria-atomic="true"
      className={`inline-block tabular-nums transition-colors duration-300 ${
        lit ? 'text-brand-600' : ''
      } ${className}`}
    >
      <span aria-hidden="true">{shown.toLocaleString()}</span>
      <span className="sr-only">{value.toLocaleString()}</span>
    </span>
  );
}
