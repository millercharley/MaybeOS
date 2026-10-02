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

/** Where an import got to: which calendar, and how far into it. */
export interface ImportCursor {
  calendar: number;
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
  if (!cursor) return { calendar: 0, entry: 0 };

  return {
    calendar: Math.max(0, Math.floor(cursor.calendar) || 0),
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
  written: number,
  entriesInCalendar: number,
  calendarCount: number,
  startedAtEntry: number,
): ImportCursor | null {
  const reached = startedAtEntry + written;

  if (reached < entriesInCalendar) {
    return { calendar, entry: reached };
  }

  return calendar + 1 < calendarCount ? { calendar: calendar + 1, entry: 0 } : null;
}
