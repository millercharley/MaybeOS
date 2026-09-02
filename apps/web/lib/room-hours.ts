import type { AvailabilityRule } from '@/lib/api';

/**
 * A room's opening hours, as a week the admin edits and rules the API stores.
 *
 * The two shapes disagree on purpose. The API stores a list of rules, each
 * with an optional weekday — which is the right thing to evaluate a booking
 * against, and a miserable thing to edit. An organiser thinks in a week: open
 * Tuesday to Saturday, ten till six, closed Sundays.
 *
 * Kept out of the component because the conversion has the interesting cases —
 * a rule that applies to every day, two windows on one day, a day with hours
 * that make no sense — and none of them are worth finding by clicking.
 */

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export interface DayHours {
  open: boolean;
  from: string;
  to: string;
}

/** Seven days, Sunday first. */
export type Week = DayHours[];

const CLOSED: DayHours = { open: false, from: '09:00', to: '17:00' };

export const emptyWeek = (): Week => WEEKDAYS.map(() => ({ ...CLOSED }));

/**
 * Turn stored rules into a week.
 *
 * A rule with no weekday applies to every day, so it fills any day that has no
 * rule of its own — dropping it, or letting it overwrite a specific day, both
 * lose hours the co-op actually published.
 *
 * Blackouts are ignored here: they subtract from opening hours rather than
 * describing them, and folding the two together would show a room as shut on a
 * day it is open for most of.
 */
export function weekFromRules(rules: AvailabilityRule[] = []): Week {
  const week = emptyWeek();
  const allDays = rules.filter((r) => !r.isBlackout && r.dayOfWeek === null);
  const perDay = rules.filter((r) => !r.isBlackout && r.dayOfWeek !== null);

  for (const rule of allDays) {
    for (const day of week) {
      day.open = true;
      day.from = rule.startTime;
      day.to = rule.endTime;
    }
  }

  for (const rule of perDay) {
    const day = week[rule.dayOfWeek as number];
    if (!day) continue;

    // Two windows on one day is representable in the API and not in this
    // editor. The widest span is kept, so saving never silently shortens a
    // day the co-op had published.
    day.from = day.open && day.from < rule.startTime ? day.from : rule.startTime;
    day.to = day.open && day.to > rule.endTime ? day.to : rule.endTime;
    day.open = true;
  }

  return week;
}

/**
 * Turn a week into the rules to create.
 *
 * Days that share hours collapse into one all-days rule only when *every* day
 * is open with the same hours — a partial collapse would need per-day rules
 * anyway, and two ways of saying the same thing is how the reader ends up
 * unsure which one won.
 */
export function rulesFromWeek(week: Week): {
  dayOfWeek: number | null;
  startTime: string;
  endTime: string;
}[] {
  const open = week.filter((d) => d.open);
  if (open.length === 0) return [];

  const everyDay =
    open.length === 7 && open.every((d) => d.from === open[0].from && d.to === open[0].to);

  if (everyDay) {
    return [{ dayOfWeek: null, startTime: open[0].from, endTime: open[0].to }];
  }

  return week
    .map((day, index) => ({ day, index }))
    .filter(({ day }) => day.open)
    .map(({ day, index }) => ({
      dayOfWeek: index,
      startTime: day.from,
      endTime: day.to,
    }));
}

/**
 * What is wrong with this week, in a sentence, or nothing.
 *
 * Checked before saving rather than after: a day whose closing time is before
 * its opening time stores happily and then silently offers no slots, which
 * reads as the feature being broken rather than the hours being wrong.
 */
export function problemWith(week: Week): string | null {
  for (const [index, day] of week.entries()) {
    if (!day.open) continue;

    if (!/^\d{2}:\d{2}$/.test(day.from) || !/^\d{2}:\d{2}$/.test(day.to)) {
      return `${WEEKDAYS[index]} needs both an opening and a closing time.`;
    }
    if (day.to <= day.from) {
      return `${WEEKDAYS[index]} closes before it opens. Rooms cannot yet be booked past midnight.`;
    }
  }

  return null;
}

/** "Tue–Sat, 10:00–18:00" — how the hours read at a glance. */
export function summarise(week: Week): string {
  const open = week
    .map((day, index) => ({ day, index }))
    .filter(({ day }) => day.open);

  if (open.length === 0) return 'No bookable hours set.';

  const sameHours = open.every(
    ({ day }) => day.from === open[0].day.from && day.to === open[0].day.to,
  );

  const hours = sameHours
    ? `${open[0].day.from}–${open[0].day.to}`
    : 'varying hours';

  if (open.length === 7) return `Every day, ${hours}`;

  const names = open.map(({ index }) => WEEKDAYS[index].slice(0, 3));
  return `${names.join(', ')}, ${hours}`;
}
