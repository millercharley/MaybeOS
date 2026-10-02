/**
 * Importing a calendar in pieces (CAL-05).
 *
 * MaybeItsFate's import returned 504. Nine calendars and a year of entries do
 * not fit in a Lambda's wall clock, and the whole run is lost when it runs
 * out — along with any way of telling whether it got nowhere or nearly all
 * the way.
 *
 * So the run stops when it is nearly out of time and says where it got to,
 * and the client asks again. A budget rather than a fixed batch size,
 * because the thing being rationed is seconds: a hundred upserts might take
 * two seconds or nine depending on what else the database is doing, and a
 * batch size tuned on a good day fails on a bad one.
 */

/**
 * Where an import got to: which calendar, which page of it, and how far into
 * that page.
 *
 * `page` is Google's own token (CAL-06). Without it every chunk re-read the
 * whole calendar from the start before it could slice its share out —
 * roughly six round trips to Google per chunk for a calendar of 1,365
 * entries, paid again on every chunk, which is where MaybeItsFate's import
 * spent forty requests to write 274 reservations and stopped in the same
 * place twice. One page in, one page written.
 */
export interface ImportCursor {
  calendar: number;
  /** Google's page token. Absent means the first page of this calendar. */
  page?: string | null;
  entry: number;
}

/**
 * How long one request may spend writing.
 *
 * Netlify gives a synchronous function ten seconds. Reading the calendar from
 * Google happens first and is not free, so the writing budget is well under
 * that — a request that returns a cursor is cheap, and one that times out
 * costs the admin everything it did.
 */
export const WRITE_BUDGET_MS = 6_000;

export function startOf(cursor: ImportCursor | null | undefined): ImportCursor {
  if (!cursor) return { calendar: 0, page: null, entry: 0 };

  return {
    calendar: Math.max(0, Math.floor(cursor.calendar) || 0),
    page: cursor.page || null,
    entry: Math.max(0, Math.floor(cursor.entry) || 0),
  };
}

/** A clock that says when to stop, injected so tests do not sleep. */
export function deadline(budgetMs = WRITE_BUDGET_MS, now = () => Date.now()) {
  const stopAt = now() + budgetMs;
  return () => now() >= stopAt;
}

/**
 * Where to resume, given where this chunk stopped.
 *
 * `null` means finished — there is nothing after the last calendar, and the
 * client stops asking.
 */
export function nextCursor(
  calendar: number,
  calendarCount: number,
  page: {
    /** The token this chunk read from. */
    token: string | null;
    /** Google's token for the page after it, or null at the end. */
    nextToken: string | null;
    /** Entries on this page. */
    length: number;
  },
  startedAtEntry: number,
  handled: number,
): ImportCursor | null {
  const reached = startedAtEntry + handled;

  // More of this page to do.
  if (reached < page.length) {
    return { calendar, page: page.token, entry: reached };
  }

  // Page done, more pages in this calendar.
  if (page.nextToken) {
    return { calendar, page: page.nextToken, entry: 0 };
  }

  // Calendar done.
  return calendar + 1 < calendarCount ? { calendar: calendar + 1, page: null, entry: 0 } : null;
}
