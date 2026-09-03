import { instantAt, zonedParts } from '../space/availability/zoned-time';

/**
 * When a duty comes round (SRV-01).
 *
 * A duty is a rule, not a table of dates. "Trash, Tuesdays, 30 minutes" is one
 * row, and the Tuesdays are computed here on the way to the screen — the same
 * shape as room slots, and for the same reasons: nothing to keep topped up,
 * nothing stale left behind when an organiser moves the day, and no argument
 * about whether the rule or the generated rows are the truth.
 *
 * Everything is computed through the co-op's own timezone. "Tuesdays at nine"
 * has to stay nine o'clock across a daylight saving change, which it does not
 * if occurrences are stepped forward in milliseconds.
 */

export type Recurrence = 'NONE' | 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

export interface DutyRule {
  recurrence: Recurrence;
  /** The first occurrence, as an instant. */
  startsOn: Date;
  /** The last, or null for as long as the co-op needs it doing. */
  endsOn: Date | null;
  /** "HH:MM" in the co-op's timezone. */
  startTime: string;
}

export interface Occurrence {
  /** The local date it falls on, "YYYY-MM-DD". */
  date: string;
  /** When it starts, as an instant — the key a claim is stored against. */
  occursAt: Date;
}

/** "09:30" → 570. Anything unparseable is nine in the morning. */
export function minutesOfDay(time: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time ?? '');
  if (!match) return 9 * 60;

  const hours = Math.min(23, Number(match[1]));
  const mins = Math.min(59, Number(match[2]));
  return hours * 60 + mins;
}

/** Days between two local dates. Both are "YYYY-MM-DD". */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Every local date from `from` to `to` inclusive. */
function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const span = daysBetween(from, to);
  if (span < 0) return out;

  const start = Date.parse(`${from}T00:00:00Z`);
  for (let i = 0; i <= span; i += 1) {
    out.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/** Whether a duty's rule lands on this local date. */
function falls(rule: DutyRule, first: string, date: string): boolean {
  const step = daysBetween(first, date);
  if (step < 0) return false;

  switch (rule.recurrence) {
    case 'NONE':
      return step === 0;
    case 'DAILY':
      return true;
    case 'WEEKLY':
      return step % 7 === 0;
    case 'BIWEEKLY':
      return step % 14 === 0;
    case 'MONTHLY': {
      // The same day number each month, and skipped where it does not exist.
      // A duty set for the 31st happens seven times a year rather than
      // silently sliding to the 1st of the next month, which would put it in
      // a different month from the one the organiser chose.
      return date.slice(8) === first.slice(8);
    }
    default:
      return false;
  }
}

/**
 * Every occurrence of a duty between two local dates, inclusive.
 *
 * `from` and `to` are "YYYY-MM-DD" in the co-op's timezone — the window a
 * screen is asking about, not the life of the duty.
 */
export function occurrencesBetween(
  rule: DutyRule,
  from: string,
  to: string,
  timeZone: string,
): Occurrence[] {
  const first = zonedParts(rule.startsOn, timeZone).date;
  const last = rule.endsOn ? zonedParts(rule.endsOn, timeZone).date : null;

  const minutes = minutesOfDay(rule.startTime);
  const windowStart = from > first ? from : first;
  const windowEnd = last && last < to ? last : to;

  return datesBetween(windowStart, windowEnd)
    .filter((date) => falls(rule, first, date))
    .map((date) => ({ date, occursAt: instantAt(date, minutes, timeZone) }));
}

/**
 * The next `count` occurrences at or after `from`.
 *
 * Bounded by a lookahead rather than running to `endsOn`, because an
 * open-ended weekly duty has no last occurrence and something has to stop.
 */
export function nextOccurrences(
  rule: DutyRule,
  from: string,
  count: number,
  timeZone: string,
  lookaheadDays = 400,
): Occurrence[] {
  const horizon = new Date(Date.parse(`${from}T00:00:00Z`) + lookaheadDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  return occurrencesBetween(rule, from, horizon, timeZone).slice(0, count);
}
