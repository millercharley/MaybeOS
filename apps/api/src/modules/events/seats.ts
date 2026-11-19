/**
 * How many people an RSVP is for (EVT-64).
 *
 * `_count.rsvps` counts *rows*, and a row can be a party. Since EVT-47 a
 * couple is one RSVP with `plusOnes: 1`, so an evening capped at 20 could
 * take 20 rows worth 34 people and still report itself open.
 *
 * The product already knew how to count people in two places — the door
 * list and the monthly recap both sum `1 + plusOnes` and call it
 * "expected". The one place that did not was `determineRsvpStatus`, which
 * is the only one that decides whether somebody gets in.
 *
 * ## Two bugs, not one
 *
 * The gate compared `_count.rsvps >= capacity`, so it ignored the plus-ones
 * **already confirmed** — and also the plus-ones of the booking being made.
 * One place left on a sold-out evening would admit a party of four.
 *
 * A party is admitted whole or waitlisted whole. Letting two of four in is
 * not a thing a door can do.
 */

/** How many places this one RSVP occupies. The person, plus who they bring. */
export function seatsFor(plusOnes: number | null | undefined): number {
  return 1 + Math.max(0, plusOnes ?? 0);
}

/** Seats already taken, from a count of rows and the sum of their plus-ones. */
export function seatsFrom(rows: number, plusOnesSum: number | null | undefined): number {
  return Math.max(0, rows) + Math.max(0, plusOnesSum ?? 0);
}

/** The same, when the rows themselves are to hand. */
export function seatsTaken(rsvps: { plusOnes?: number | null }[]): number {
  return rsvps.reduce((total, rsvp) => total + seatsFor(rsvp.plusOnes), 0);
}

export type Admission = 'CONFIRMED' | 'WAITLISTED' | 'FULL';

/**
 * Whether a party gets in, goes on the waitlist, or is turned away.
 *
 * `capacity: null` is no limit, which is most events.
 *
 * Measured against the party's *whole* size, so the last two places do not
 * swallow a group of five and leave the room over capacity on the night.
 */
export function admits(
  capacity: number | null,
  taken: number,
  party: number,
  waitlistEnabled: boolean,
): Admission {
  if (capacity === null) return 'CONFIRMED';
  if (taken + party <= capacity) return 'CONFIRMED';

  return waitlistEnabled ? 'WAITLISTED' : 'FULL';
}

/**
 * What a capacity line should say — "14 of 20 places taken".
 *
 * Null when there is no capacity, because a bar with no end is not a bar
 * (DESIGN §7).
 */
export function placesLine(taken: number, capacity: number | null): string | null {
  if (capacity === null || capacity <= 0) return null;

  return `${taken} of ${capacity} places taken`;
}
