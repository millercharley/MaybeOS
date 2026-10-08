/**
 * Which band of an event's picture survives the crop (EVT-43).
 *
 * Charley, looking at the dashboard: "Ask the user to set the focus on the
 * image so we don't see heads cut off like this." The card showed JG Shadid
 * from the shoulders down.
 *
 * Every frame an event's art appears in is wider than it is tall — the card,
 * the list thumbnail, the dashboard, the detail page — so `object-fit: cover`
 * takes a horizontal band out of the middle of a portrait photograph. The
 * middle is the wrong guess for the most common subject there is: a person,
 * whose head is at the top.
 *
 * One number, because there is only one real choice. The horizontal half is
 * always centred: these frames are wider than the source, so nothing is lost
 * sideways, and offering a second slider that changes nothing would be a
 * control that lies.
 */

/** The middle, which is what `object-fit: cover` does on its own. */
export const DEFAULT_FOCUS_Y = 50;

/** Percent down the image, clamped — this arrives from a database and a form. */
export function focusY(value: number | null | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_FOCUS_Y;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * The style to put on an `object-cover` image.
 *
 * Returned as a style object rather than a Tailwind class because the value is
 * a number from the database: `object-[50%_25%]` would need every percentage
 * to exist in the compiled stylesheet, and the ones nobody has used yet would
 * silently do nothing.
 */
export function focusStyle(value: number | null | undefined): { objectPosition: string } {
  return { objectPosition: `50% ${focusY(value)}%` };
}

/**
 * Where to put the marquee in the focus control's preview.
 *
 * The band kept is as tall a slice of the source as the frame's shape allows,
 * and it slides between the top and the bottom — so at 0 it sits flush with
 * the top edge rather than hanging over it, which is the same arithmetic the
 * Handbook's horizontal focus uses.
 */
export function bandTopPct(value: number, bandHeightPct: number): number {
  const clamped = Math.min(100, Math.max(0, value));
  return (clamped / 100) * (100 - bandHeightPct);
}
