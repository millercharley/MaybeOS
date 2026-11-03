/**
 * When a room reservation is, written so it cannot be misread as another year.
 *
 * Charley: "I see Room reservations inside My Bookings that have already past
 * (ones in October for example) listed under the upcoming tab."
 *
 * They had not passed. They were in **October 2028** — real reservations, from
 * recurring Google series that the calendar import materialised years out, and
 * MaybeItsFate has a hundred of them. My Bookings formatted a date as
 * "Sat, 14 Oct" with no year at all, so a reservation two years ahead was
 * indistinguishable from one last month, sitting at the bottom of a list
 * sorted soonest-first where everything above it was next week. The list was
 * right and the sentence was wrong.
 *
 * So: the year appears whenever it is not the year the reader is in. Not
 * always — "Fri, 6 Nov 2026" on every row of a list that is almost entirely
 * this month is noise, and noise is what made the one row that mattered easy
 * to skim past.
 */

const DAY = { weekday: 'short', day: 'numeric', month: 'short' } as const;
const TIME = { hour: 'numeric', minute: '2-digit' } as const;

/**
 * `"Sat, 14 Oct 2028 – 5:30 PM"`, or without the year inside the current one.
 *
 * The end is a time and not a date, which is what this has always shown: a
 * reservation runs for hours, not days, and the room is named beside it.
 */
export function bookingWhen(
  startISO: string,
  endISO: string,
  now: Date = new Date(),
): string {
  const start = new Date(startISO);
  const end = new Date(endISO);

  const day = new Intl.DateTimeFormat(undefined, {
    ...DAY,
    // Compared in the reader's own zone, like everything else on this page:
    // the boundary that matters is the one on their calendar, not UTC's.
    ...(start.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(start);

  return `${day} – ${new Intl.DateTimeFormat(undefined, TIME).format(end)}`;
}
