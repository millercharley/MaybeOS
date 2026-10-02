/**
 * Walking a roster that does not fit on one screen (MEM-22).
 *
 * The admin Members page fetched the first 50 and drew them, with nothing
 * that reached the rest — so MaybeItsFate's 426 members looked like 50. The
 * quieter half of the same bug was the search box: it filtered the rows the
 * browser happened to be holding, which meant searching a 426-member co-op
 * looked through 50 of them and said "No members found".
 */

export const PER_PAGE = 50;

/** Pauses before a search reaches the server, so typing is not 400 requests. */
export const SEARCH_DEBOUNCE_MS = 300;

export interface Meta {
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

/** Whether there is more roster after what has been loaded so far. */
export function hasMore(loaded: number, meta: Meta | null | undefined): boolean {
  if (!meta) return false;
  return loaded < meta.total;
}

/**
 * What to say under the table.
 *
 * Always states the total, because the number an organiser came to this page
 * for is usually "how many of us are there" — and because a list that stops
 * at 50 with nothing said is how you conclude the import dropped 376 people.
 */
export function rosterCount(loaded: number, meta: Meta | null | undefined, searching: boolean): string {
  if (!meta) return '';

  const { total } = meta;
  const members = total === 1 ? '1 member' : `${total.toLocaleString()} members`;

  if (searching) {
    if (total === 0) return 'No members match that search.';
    return loaded < total
      ? `Showing ${loaded.toLocaleString()} of ${members} matching that search.`
      : `${members} match that search.`;
  }

  if (total === 0) return 'No members yet.';
  return loaded < total
    ? `Showing ${loaded.toLocaleString()} of ${members}.`
    : `All ${members}.`;
}

/**
 * Add a page to what is already shown, without duplicating anybody.
 *
 * A roster is ordered by join date and people join while an organiser reads
 * it, which shifts every later row down by one — so page 2 can legitimately
 * repeat somebody from page 1. Rendering the same member twice reads as a
 * duplicated membership, which on this page of all pages is alarming.
 */
export function appendPage<T extends { id: string }>(loaded: T[], next: T[]): T[] {
  const seen = new Set(loaded.map((item) => item.id));

  return [...loaded, ...next.filter((item) => !seen.has(item.id))];
}
