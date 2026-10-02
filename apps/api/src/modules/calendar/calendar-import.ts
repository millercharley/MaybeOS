import { calendar_v3 } from 'googleapis';

/**
 * Reading somebody's Google calendar into a co-op's own shape (CAL-02).
 *
 * Pure, because every judgement in a calendar import is a guess about what
 * somebody meant when they typed into a box that was never a MaybeOS form —
 * and guesses belong where they can be read and tested rather than buried in
 * a loop that also talks to Google.
 *
 * The guesses, stated plainly:
 *
 *   - **An entry with no start is not an importable thing.** Google returns
 *     these for malformed and cancelled rows; skipping is the only honest
 *     answer.
 *   - **An all-day entry is a day, not a time.** Google gives it a `date`
 *     rather than a `dateTime`, and treating it as midnight-to-midnight in
 *     the co-op's zone is closer to what somebody meant than a UTC instant
 *     that lands on the wrong evening.
 *   - **A cancelled entry is skipped**, and on a re-run it unpublishes what
 *     it created before rather than leaving a ghost in the events list.
 *   - **The organiser's email is how a host is found.** It is the only
 *     identity Google carries that MaybeOS also holds.
 */

export interface ImportedEntry {
  googleEventId: string;
  title: string;
  description: string | null;
  start: Date;
  end: Date;
  /** Google's own flag, kept so a caller can decide what to do with it. */
  cancelled: boolean;
  /** Whether it was an all-day entry, which changes what the times mean. */
  allDay: boolean;
  organiserEmail: string | null;
  /** As Google has it — the display name on the invitation (CAL-03). */
  organiserName: string | null;
  location: string | null;
}

/** Midnight in `timeZone` on an all-day entry's date, as an instant. */
function startOfDay(date: string, timeZone: string): Date {
  // The same two-pass trick `instantAt` uses: the offset depends on the
  // answer, and getting it wrong moves an event by a day twice a year.
  const naive = Date.parse(`${date}T00:00:00Z`);
  const guess = new Date(naive);
  const offset =
    new Date(guess.toLocaleString('en-US', { timeZone })).getTime() -
    new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();

  return new Date(naive - offset);
}

export function toEntry(
  raw: calendar_v3.Schema$Event,
  timeZone: string,
): ImportedEntry | null {
  if (!raw.id) return null;

  const startDateTime = raw.start?.dateTime;
  const endDateTime = raw.end?.dateTime;
  const startDate = raw.start?.date;
  const endDate = raw.end?.date;

  let start: Date;
  let end: Date;
  let allDay = false;

  if (startDateTime) {
    start = new Date(startDateTime);
    // Google omits an end on some imported rows. An hour is a guess, and a
    // stated one: better than an event that ends before it starts.
    end = endDateTime ? new Date(endDateTime) : new Date(start.getTime() + 60 * 60 * 1000);
  } else if (startDate) {
    allDay = true;
    start = startOfDay(startDate, timeZone);
    // Google's all-day end date is exclusive — a one-day entry ends the
    // following morning — so it needs no adjustment beyond being read.
    end = endDate ? startOfDay(endDate, timeZone) : new Date(start.getTime() + 24 * 60 * 60 * 1000);
  } else {
    return null;
  }

  if (!(start.getTime() < end.getTime())) return null;

  return {
    googleEventId: raw.id,
    // A calendar entry with no title is common and harmless; the co-op's own
    // list should still say something rather than show a blank row.
    title: raw.summary?.trim() || 'Untitled',
    description: raw.description?.trim() || null,
    start,
    end,
    cancelled: raw.status === 'cancelled',
    allDay,
    organiserEmail: raw.organizer?.email?.toLowerCase().trim() || null,
    organiserName: raw.organizer?.displayName?.trim() || null,
    location: raw.location?.trim() || null,
  };
}

/** The window an import covers: a year back by default, and everything ahead. */
export function importWindow(now: Date, monthsBack: number): { from: Date; to: Date } {
  const from = new Date(now);
  from.setMonth(from.getMonth() - monthsBack);

  // Two years ahead rather than unbounded: a co-op with a standing weekly
  // booking has an endless calendar, and "everything ahead" would import
  // until Google ran out of recurrences.
  const to = new Date(now);
  to.setFullYear(to.getFullYear() + 2);

  return { from, to };
}
