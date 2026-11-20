/**
 * When the co-op's weekly post goes out, and what span it covers (SOC-05).
 *
 * Charley: "Allow the Admin to set their time preference of when the post
 * will be sent to Instagram and/or Facebook. The default is the image posts
 * on Thursday mornings, listing events from Thursday through the following
 * Sunday (11 day horizon)."
 *
 * Decisions only — no Prisma, no clock, no Graph API.
 *
 * ## Dates here are strings, deliberately
 *
 * "Thursday at 9" is a sentence about where the co-op is, and every event in
 * the database is a UTC instant. Bridging those with a `Date` built from
 * local components is the bug `zoned-time.ts` was written to kill: it works
 * on a laptop in New York and prints UTC on a Lambda. So this file speaks in
 * `YYYY-MM-DD` and weekday numbers, and the caller uses `instantAt` — which
 * already handles the two mornings a year when the offset changes — to turn
 * them back into instants.
 */

export interface WeeklySchedule {
  /** ISO weekday, 1 Monday to 7 Sunday. */
  day: number;
  /** Hour in the co-op's own timezone, 0 to 23. */
  hour: number;
  /** Days covered, counting the post's own. */
  days: number;
}

export const DEFAULT_SCHEDULE: WeeklySchedule = { day: 4, hour: 9, days: 11 };

/** `zonedParts` gives 0–6 from Sunday; everything else here speaks ISO. */
export function isoWeekday(sundayZero: number): number {
  return sundayZero === 0 ? 7 : sundayZero;
}

/**
 * Whether this co-op is due, given where its clock has got to.
 *
 * True for the whole of the chosen hour rather than an instant. The scheduler
 * runs every fifteen minutes, and a schedule that has to land on a minute is
 * one that silently skips a week whenever a run is slow — so four runs answer
 * true, and the unique index on the week's row is what makes only the first
 * of them count. That is the monthly recap's arrangement, copied rather than
 * reinvented.
 */
export function isDue(
  parts: { dayOfWeek: number; minutes: number },
  schedule: WeeklySchedule,
): boolean {
  return (
    isoWeekday(parts.dayOfWeek) === schedule.day &&
    Math.floor(parts.minutes / 60) === schedule.hour
  );
}

/** `YYYY-MM-DD` plus whole days, with no timezone anywhere near it. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * The span the post covers, as local dates.
 *
 * `from` is the day it goes out, so an event earlier that same morning is
 * still named: the post is about the day, not the moment it was sent.
 * `toExclusive` is the morning after the last day, which is what the query
 * wants — asking for "before the 7th" needs no reasoning about whether
 * 23:59:59.999 is inside a span, and an event at 11pm on the Sunday is in
 * either way.
 *
 * Eleven days from Thursday reaches the following Sunday. Worth saying,
 * because "a week" would be four days short of what Charley asked for.
 */
export function weeklyWindow(
  startDate: string,
  days: number,
): { from: string; lastDay: string; toExclusive: string } {
  const span = Math.max(1, days);
  return {
    from: startDate,
    lastDay: addDays(startDate, span - 1),
    toExclusive: addDays(startDate, span),
  };
}

/** The stored settings, or the defaults where somebody wrote nonsense. */
export function sanitiseSchedule(raw: Partial<WeeklySchedule> | null | undefined): WeeklySchedule {
  const whole = (value: unknown, fallback: number, lo: number, hi: number) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= lo && n <= hi ? n : fallback;
  };

  return {
    day: whole(raw?.day, DEFAULT_SCHEDULE.day, 1, 7),
    hour: whole(raw?.hour, DEFAULT_SCHEDULE.hour, 0, 23),
    // One day is a legitimate choice; past a month it stops being "what's on"
    // and no image could hold it.
    days: whole(raw?.days, DEFAULT_SCHEDULE.days, 1, 31),
  };
}
