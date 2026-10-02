/**
 * A readable, unique address for an imported event (CAL-04).
 *
 * The first import of MaybeItsFate's calendar died on this: a unique
 * constraint on (orgId, slug), raised by `event.upsert` and fatal to the
 * whole run. The old rule was "the title, and if that is taken, the title
 * with the date" — which is fine until a co-op holds two things with the
 * same name on the same day. MaybeItsFate does; most co-ops running a
 * weekly class at two times do.
 *
 * The candidates are a sequence rather than a pair, and the last one cannot
 * collide: `googleEventId` is unique within a co-op by definition, so a slug
 * built from it is too. Ugly, and only ever reached by an event that already
 * shares a title and a day with several others — at which point an ugly
 * address is better than a failed import.
 */

/** The title, reduced to something that belongs in a URL. */
export function slugBase(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60)
      .replace(/-$/, '') || 'event'
  );
}

/** Short, stable, and unique per co-op, because `googleEventId` is. */
function fingerprint(googleEventId: string): string {
  let hash = 0;
  for (const char of googleEventId) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash).toString(36).slice(0, 8);
}

/**
 * Every address this event could have, best first.
 *
 * The caller walks it and takes the first one free. Finite: an import that
 * asked for candidates forever would hang a Lambda rather than fail it,
 * which is harder to notice and worse to debug.
 */
export function slugCandidates(
  title: string,
  start: Date,
  googleEventId: string,
): string[] {
  const base = slugBase(title);
  const day = start.toISOString().slice(0, 10);

  return [
    base,
    `${base}-${day}`,
    // A co-op with three things of one name on one day is real; one with
    // twelve is a calendar that needs a human, not more suffixes.
    ...Array.from({ length: 10 }, (_, i) => `${base}-${day}-${i + 2}`),
    `${base}-${fingerprint(googleEventId)}`,
  ];
}
