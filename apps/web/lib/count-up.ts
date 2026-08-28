/**
 * The maths behind a number that rolls (delight #1).
 *
 * Pulled out of the component because the interesting decisions are here and
 * none of them are about React: how long it runs, how it eases, and when it
 * should not run at all.
 */

/** ~600ms, as asked. Long enough to read as motion, short enough not to wait. */
export const ROLL_MS = 600;

/**
 * Ease-out cubic: fast at the start, settling at the end.
 *
 * A linear count looks like a loading spinner made of digits — it gives no
 * sense of arriving anywhere. Easing out means the number is legible for most
 * of the animation and only the first moment is a blur.
 */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Where the number is, part-way through.
 *
 * Rounded to the precision of the values themselves, so a member count never
 * shows "463.7" on its way to 464. A count of people is a count of people at
 * every frame, not only at the end.
 */
export function frameValue(from: number, to: number, progress: number, decimals: number): number {
  const eased = easeOutCubic(Math.min(Math.max(progress, 0), 1));
  const raw = from + (to - from) * eased;
  const factor = Math.pow(10, decimals);
  return Math.round(raw * factor) / factor;
}

/** How many decimals the *data* has, so the animation never invents any. */
export function decimalsOf(value: number): number {
  if (Number.isInteger(value)) return 0;
  const text = String(value);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : Math.min(text.length - dot - 1, 2);
}

/**
 * Whether to animate at all.
 *
 * Three reasons not to, and all three matter more than the delight does:
 * somebody has asked their system for less motion; the number did not
 * actually change; or it is not a number.
 */
export function shouldAnimate(
  from: number | null,
  to: number,
  prefersReducedMotion: boolean,
): boolean {
  if (prefersReducedMotion) return false;
  if (!Number.isFinite(to)) return false;
  if (from === null) return true;
  return from !== to;
}

/**
 * The delta chip's text, or null when there is nothing worth saying.
 *
 * **Joins, not net growth.** MaybeOS does not record departures — removing a
 * membership deletes the row — so a net figure is not something this can
 * honestly compute. Saying "+2 joined" is true; saying "+2" beside a total
 * invites the reader to subtract it from last month's and get an answer
 * nobody checked.
 */
export function deltaLabel(joined: number, period = 'this month'): string | null {
  if (!Number.isFinite(joined) || joined <= 0) return null;
  return `+${joined} joined ${period}`;
}
