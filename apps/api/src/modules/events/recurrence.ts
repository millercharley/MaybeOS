import { instantAt, zonedParts } from '../space/availability/zoned-time';

/**
 * Repeating an event, the way Google Calendar asks for it (EVT-37).
 *
 * Charley: model it after Google — every day, every week on a chosen set of
 * days, every month, every year, with an interval, ending never, on a date,
 * or after a count.
 *
 * **Materialised, not a rule.** The co-op's service duties are a rule
 * computed on the way to the screen (SRV-01), and that is right for them: a
 * duty is the same every week and holds nothing. An event is not. It carries
 * RSVPs, a ticket count, a picture somebody chose, a host who might change
 * for one week in July, and — the reason this is not arguable — a room
 * reservation that has to be checked against everything else in the building
 * on that specific date. A rule cannot hold an RSVP, and a room either is or
 * is not free on the 14th.
 *
 * So each occurrence is a row, with the first as its parent. Which is also
 * what the calendar import already produces: Google is asked for
 * `singleEvents`, and every Tuesday arrives as its own entry.
 *
 * Everything is worked out in the co-op's timezone. "Tuesdays at seven" has
 * to stay seven o'clock across a clock change, which it does not if dates are
 * stepped forward in milliseconds.
 */

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface RecurrenceInput {
  frequency: Frequency;
  /** Every n days/weeks/months/years. 1 unless somebody says otherwise. */
  interval?: number;
  /**
   * For WEEKLY: which days, 0 = Sunday. Empty means the day the first one
   * falls on, which is what Google does when you pick "weekly" and nothing
   * else.
   */
  weekdays?: number[];
  /** Stop after this many occurrences, counting the first. */
  count?: number;
  /** Stop on or before this instant. */
  until?: Date;
}

/**
 * How many occurrences one rule may make.
 *
 * Google will happily repeat forever; a row per occurrence cannot. Two years
 * of a weekly event is 104, of a daily one 730 — and a co-op that wants more
 * extends it rather than planning its 2029 from here. The cap is also what
 * stops "every day, ends never" writing until the request times out.
 */
export const MAX_OCCURRENCES = 200;

/** "YYYY-MM-DD" shifted by whole days, which is not the same as adding hours. */
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Days in a month, so the 31st does not slide into the next one. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Every time this event happens, the first included.
 *
 * Instants for the *start* of each occurrence; the caller keeps the duration,
 * because an event that runs 7–9pm runs 7–9pm every week.
 *
 * Built out of local dates and `instantAt`, which is what keeps "Tuesdays at
 * seven" at seven across a clock change — the same two-pass correction the
 * room slots use.
 */
export function occurrencesOf(
  firstStart: Date,
  rule: RecurrenceInput,
  timeZone: string,
): Date[] {
  const interval = Math.max(1, Math.floor(rule.interval ?? 1));
  const limit = Math.min(MAX_OCCURRENCES, Math.max(1, Math.floor(rule.count ?? MAX_OCCURRENCES)));
  const until = rule.until ?? null;

  const first = zonedParts(firstStart, timeZone);
  const at = (date: string) => instantAt(date, first.minutes, timeZone);

  const out: Date[] = [];
  /** Returns false once the list is finished, for whichever reason. */
  const take = (date: string): boolean => {
    const moment = at(date);
    if (moment.getTime() < firstStart.getTime()) return true;
    if (until && moment.getTime() > until.getTime()) return false;

    out.push(moment);
    return out.length < limit;
  };

  if (rule.frequency === 'WEEKLY') {
    const days = (rule.weekdays?.length ? [...new Set(rule.weekdays)] : [first.dayOfWeek])
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      .sort((a, b) => a - b);
    if (days.length === 0) days.push(first.dayOfWeek);

    // The Sunday of the first occurrence's week, so a set of weekdays comes
    // out in calendar order rather than starting mid-week.
    const weekStart = shiftDate(first.date, -first.dayOfWeek);

    for (let week = 0; week < MAX_OCCURRENCES; week += interval) {
      for (const dow of days) {
        if (!take(shiftDate(weekStart, week * 7 + dow))) return out;
      }
    }
    return out;
  }

  const [firstYear, firstMonth, firstDay] = first.date.split('-').map(Number);

  for (let step = 0; step <= MAX_OCCURRENCES * 12; step += 1) {
    let date: string;

    if (rule.frequency === 'DAILY') {
      date = shiftDate(first.date, step * interval);
    } else if (rule.frequency === 'MONTHLY') {
      const months = firstMonth - 1 + step * interval;
      const year = firstYear + Math.floor(months / 12);
      const month = (months % 12) + 1;
      // The 31st of a 30-day month is skipped rather than slid to the 1st:
      // sliding puts it in a month the organiser did not choose.
      if (firstDay > daysInMonth(year, month)) continue;
      date = `${year}-${String(month).padStart(2, '0')}-${String(firstDay).padStart(2, '0')}`;
    } else {
      const year = firstYear + step * interval;
      // 29 February, same reasoning.
      if (firstDay > daysInMonth(year, firstMonth)) continue;
      date = `${year}-${String(firstMonth).padStart(2, '0')}-${String(firstDay).padStart(2, '0')}`;
    }

    if (!take(date)) break;
  }

  return out;
}

/** How a repeat reads, for a confirmation somebody can check (EVT-37). */
export function describeRecurrence(rule: RecurrenceInput, occurrences: number): string {
  const every = rule.interval && rule.interval > 1 ? `every ${rule.interval} ` : 'every ';
  const unit = {
    DAILY: rule.interval && rule.interval > 1 ? 'days' : 'day',
    WEEKLY: rule.interval && rule.interval > 1 ? 'weeks' : 'week',
    MONTHLY: rule.interval && rule.interval > 1 ? 'months' : 'month',
    YEARLY: rule.interval && rule.interval > 1 ? 'years' : 'year',
  }[rule.frequency];

  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const on =
    rule.frequency === 'WEEKLY' && rule.weekdays?.length
      ? ` on ${rule.weekdays
          .slice()
          .sort((a, b) => a - b)
          .map((d) => names[d])
          .join(', ')}`
      : '';

  return `${occurrences} ${occurrences === 1 ? 'time' : 'times'}, ${every}${unit}${on}`;
}
