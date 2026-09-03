import { instantAt, zonedParts } from '../space/availability/zoned-time';

/**
 * When a host briefing is due for a given booking (SRV-03).
 *
 * Charley's two defaults are two different kinds of schedule and this is the
 * whole reason for the `anchor` field: **"7am on the day"** is a clock time in
 * the co-op's timezone, and **"an hour before it ends"** is an offset from an
 * instant. Expressing the first as "minutes before start" would give a
 * different time of day for every booking, which is not what "the morning of"
 * means.
 */
export type BriefingAnchor =
  | 'CLOCK_ON_DAY'
  | 'BEFORE_START'
  | 'AFTER_START'
  | 'BEFORE_END'
  | 'AFTER_END';

export interface BriefingRule {
  anchor: BriefingAnchor;
  /** "HH:MM" in the co-op's timezone. Read only for CLOCK_ON_DAY. */
  clockTime: string;
  /** Minutes. Read for every anchor except CLOCK_ON_DAY. */
  offsetMinutes: number;
}

export interface BookingWindow {
  startTime: Date;
  endTime: Date;
}

/** "07:00" → 420. Anything unparseable is 7am, which is the documented default. */
export function minutesOfClock(time: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time ?? '');
  if (!match) return 7 * 60;

  return Math.min(23, Number(match[1])) * 60 + Math.min(59, Number(match[2]));
}

/**
 * The instant a briefing should go out.
 *
 * `CLOCK_ON_DAY` resolves against the booking's *local* date, so a 7am
 * briefing is 7am where the room is — including across a daylight saving
 * change, which `instantAt` handles in two passes.
 */
export function dueAt(
  rule: BriefingRule,
  booking: BookingWindow,
  timeZone: string,
): Date {
  const ms = rule.offsetMinutes * 60_000;

  switch (rule.anchor) {
    case 'CLOCK_ON_DAY': {
      const day = zonedParts(booking.startTime, timeZone).date;
      return instantAt(day, minutesOfClock(rule.clockTime), timeZone);
    }
    case 'BEFORE_START':
      return new Date(booking.startTime.getTime() - ms);
    case 'AFTER_START':
      return new Date(booking.startTime.getTime() + ms);
    case 'BEFORE_END':
      return new Date(booking.endTime.getTime() - ms);
    case 'AFTER_END':
      return new Date(booking.endTime.getTime() + ms);
  }
}

/**
 * How late a briefing may be and still go out.
 *
 * Without a floor, switching the feature on would mail every host in the
 * co-op's history at once: their due times are all in the past, and "due and
 * not yet sent" would be true of every one. Two hours is generous against a
 * scheduler that runs every fifteen minutes and mean enough that a booking
 * from March stays quiet.
 */
export const GRACE_MINUTES = 120;

/** Whether a briefing due at `due` should be sent in a run happening `now`. */
export function isDue(due: Date, now: Date): boolean {
  const ms = now.getTime() - due.getTime();
  return ms >= 0 && ms <= GRACE_MINUTES * 60_000;
}

/**
 * A briefing a booking could never have received.
 *
 * A member booking a room at 9am for that afternoon cannot be sent the 7am
 * "morning of" message, and should not get it two hours late either — the
 * moment it describes has passed.
 */
export function missedItsMoment(due: Date, bookedAt: Date): boolean {
  return due < bookedAt;
}
