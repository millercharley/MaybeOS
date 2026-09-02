/**
 * The month grid and the labels around it.
 *
 * Pulled out of the component because it is arithmetic with edge cases —
 * leading blanks, month boundaries, the local day — and none of that is worth
 * testing through a rendered calendar.
 */

/** "YYYY-MM-DD" for a date, in the given timezone. */
export function localDate(instant: Date, timeZone: string): string {
  // `en-CA` renders as YYYY-MM-DD, which saves parsing the parts back out.
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(instant);
}

/** "YYYY-MM" for a date string. */
export const monthOf = (date: string): string => date.slice(0, 7);

/** The month before or after, wrapping the year. */
export function shiftMonth(month: string, by: number): string {
  const [year, index] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, index - 1 + by, 1));

  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface Cell {
  date: string | null;
  day: number | null;
}

/**
 * A month as a grid of cells, Sunday first, padded so the first of the month
 * lands under its weekday.
 *
 * Nulls rather than dates from the neighbouring months: a greyed-out 31st of
 * August under a September heading is something people click.
 */
export function monthGrid(month: string): Cell[] {
  const [year, index] = month.split('-').map(Number);
  const firstWeekday = new Date(Date.UTC(year, index - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, index, 0)).getUTCDate();

  const cells: Cell[] = Array.from({ length: firstWeekday }, () => ({
    date: null,
    day: null,
  }));

  for (let day = 1; day <= days; day += 1) {
    cells.push({
      date: `${month}-${String(day).padStart(2, '0')}`,
      day,
    });
  }

  return cells;
}

/** "September 2026". */
export function monthLabel(month: string): string {
  const [year, index] = month.split('-').map(Number);

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, index - 1, 1)));
}

/** "Wednesday, September 2". */
export function dateLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** "04:30 pm" for minutes past midnight. */
export function timeLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const suffix = hours < 12 ? 'am' : 'pm';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;

  return `${String(twelve).padStart(2, '0')}:${String(mins).padStart(2, '0')} ${suffix}`;
}

/** "30 min", "1 hour", "1 h 30 min". */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = rest === 0 && hours === 1 ? '1 hour' : `${hours} h`;

  return rest === 0 ? (hours === 1 ? hourPart : `${hours} hours`) : `${hourPart} ${rest} min`;
}

/**
 * What the co-op's timezone is called where the member is reading this.
 *
 * A member booking from another city needs to know these times are the
 * building's clock, not theirs — that is the difference between arriving at
 * the right hour and arriving three hours early.
 */
export function zoneLabel(timeZone: string, now: Date): string {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'long' })
      .formatToParts(now)
      .find((p) => p.type === 'timeZoneName')?.value ?? timeZone;

  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(now);

  return `${name} (${time.toLowerCase()})`;
}
