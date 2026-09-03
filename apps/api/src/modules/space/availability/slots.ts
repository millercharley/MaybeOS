import { instantAt, zonedParts } from './zoned-time';

/**
 * What a member can actually book, slot by slot.
 *
 * The booking screen shows every candidate time and crosses out the ones that
 * are taken, which means the reason a slot is unavailable has to survive all
 * the way to the UI. Refusing after the fact — the only thing the API could do
 * before — tells a member their choice was wrong once they have already made
 * it, and tells them nothing about which choice would have worked.
 *
 * Pure on purpose: every input is passed in, including `now`. The rules here
 * are the ones that used to be spread across `validateAvailability`,
 * `checkConflicts` and `busyConflict`, and they were impossible to exercise
 * together without a database and a Google account.
 */

/** Minutes between one candidate start and the next. */
export const SLOT_INTERVAL_MINUTES = 30;

/** Durations offered, in minutes. Trimmed to the room's cap. */
export const DURATION_CHOICES = [30, 60, 90, 120, 180] as const;

export type Unavailable =
  | 'past'
  | 'closed'
  | 'blackout'
  | 'booked'
  | 'calendar';

export interface Slot {
  /** UTC instant the slot starts. */
  start: Date;
  end: Date;
  /** Minutes past local midnight, for rendering without re-deriving the zone. */
  minutes: number;
  available: boolean;
  reason?: Unavailable;
  /**
   * Why the room is shut, when a closure says so (SPC-18). "Closed: Winter
   * break" tells a member whether to come back tomorrow or in January; a
   * greyed-out row tells them nothing.
   */
  note?: string;
}

export interface Rule {
  dayOfWeek: number | null;
  startTime: string;
  endTime: string;
  isBlackout: boolean;
  label?: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
}

export interface Busy {
  start: Date;
  end: Date;
}

export interface SlotQuery {
  /** Local date, "YYYY-MM-DD". */
  date: string;
  timeZone: string;
  durationMinutes: number;
  alwaysAvailable: boolean;
  rules: Rule[];
  /** Bookings that already hold the room. */
  booked: Busy[];
  /** Periods the room's Google Calendar reports busy. */
  busy: Busy[];
  /**
   * Closures that apply to the whole building (SPC-19).
   *
   * Deliberately not folded into `rules`. A room with no rules of its own is
   * *unfinished*, not open around the clock — and merging a building closure
   * into that array would give such a room one rule, so it would stop looking
   * unfinished, fall through to unrestricted, and become bookable at every
   * hour of the day. These only ever subtract.
   */
  closures?: Rule[];
  now: Date;
}

const minutesOf = (hhmm: string): number => {
  const [hours, mins] = hhmm.split(':').map(Number);
  return hours * 60 + mins;
};

const overlaps = (a: Busy, b: Busy): boolean => a.start < b.end && a.end > b.start;

/**
 * Which durations this room offers.
 *
 * A cap that falls between two choices keeps the ones at or below it: a room
 * capped at 45 minutes offers 30, because offering an hour and refusing it is
 * worse than offering less.
 */
export function durationsFor(maxBookingMinutes?: number | null): number[] {
  if (!maxBookingMinutes) return [...DURATION_CHOICES];

  const offered = DURATION_CHOICES.filter((d) => d <= maxBookingMinutes);

  // Never empty: a room capped below the shortest choice can still be booked
  // for exactly its cap, which is the only honest thing to offer.
  return offered.length > 0 ? offered : [maxBookingMinutes];
}

/**
 * The opening windows for one local date, as minutes past local midnight.
 *
 * A room with no allow rules but some blackout rules means "open except
 * these", which is why the absence of allow rules is not the same as being
 * closed — the same distinction `validateAvailability` draws, kept in step.
 */
function openWindows(
  rules: Rule[],
  date: string,
  dayOfWeek: number,
  timeZone: string,
): { open: { from: number; to: number }[]; unrestricted: boolean } {
  const noon = instantAt(date, 12 * 60, timeZone);

  const applicable = rules.filter((rule) => {
    if (rule.dayOfWeek !== null && rule.dayOfWeek !== dayOfWeek) return false;
    if (rule.effectiveFrom && noon < rule.effectiveFrom) return false;
    if (rule.effectiveTo && noon > rule.effectiveTo) return false;
    return true;
  });

  const definesOpeningHours = rules.some((r) => !r.isBlackout);
  const allow = applicable.filter((r) => !r.isBlackout);

  return {
    open: allow.map((r) => ({ from: minutesOf(r.startTime), to: minutesOf(r.endTime) })),
    unrestricted: !definesOpeningHours,
  };
}

function blackouts(
  rules: Rule[],
  date: string,
  dayOfWeek: number,
  timeZone: string,
): { from: number; to: number; label?: string | null }[] {
  const noon = instantAt(date, 12 * 60, timeZone);

  return rules
    .filter((rule) => {
      if (!rule.isBlackout) return false;
      if (rule.dayOfWeek !== null && rule.dayOfWeek !== dayOfWeek) return false;
      if (rule.effectiveFrom && noon < rule.effectiveFrom) return false;
      if (rule.effectiveTo && noon > rule.effectiveTo) return false;
      return true;
    })
    .map((r) => ({
      from: minutesOf(r.startTime),
      to: minutesOf(r.endTime),
      label: r.label,
    }));
}

/**
 * Every candidate start on a date, and whether each one can be booked.
 *
 * Unavailable slots are returned rather than filtered out. A list that simply
 * omits them looks like a quiet day rather than a full one, and a member
 * cannot tell "nobody has booked this" from "everything is taken".
 */
export function slotsForDate(query: SlotQuery): Slot[] {
  const { date, timeZone, durationMinutes, rules, booked, busy, now } = query;

  const dayOfWeek = zonedParts(instantAt(date, 12 * 60, timeZone), timeZone).dayOfWeek;
  const { open, unrestricted } = openWindows(rules, date, dayOfWeek, timeZone);
  const closed = blackouts(
    [...rules, ...(query.closures ?? [])],
    date,
    dayOfWeek,
    timeZone,
  );

  // A room with neither rules nor the always-available flag is unfinished, not
  // open around the clock — those were the same state until SPC-05, and a room
  // whose hours nobody had set was bookable at 3am.
  const unfinished = !query.alwaysAvailable && rules.length === 0;
  if (unfinished) return [];

  const slots: Slot[] = [];

  for (let minutes = 0; minutes < 24 * 60; minutes += SLOT_INTERVAL_MINUTES) {
    const start = instantAt(date, minutes, timeZone);
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    const finishes = minutes + durationMinutes;

    const slot: Slot = { start, end, minutes, available: true };

    // Order matters only for which reason gets reported. Time already gone is
    // the most useful thing to say, then the room's own hours, then what
    // somebody else has taken.
    if (end <= now) {
      slot.available = false;
      slot.reason = 'past';
    } else if (
      !query.alwaysAvailable &&
      !unrestricted &&
      !open.some((w) => minutes >= w.from && finishes <= w.to)
    ) {
      slot.available = false;
      slot.reason = 'closed';
    } else if (closed.some((w) => minutes < w.to && finishes > w.from)) {
      slot.available = false;
      slot.reason = 'blackout';

      // The first closure covering this slot. Two overlapping closures is a
      // rare enough state that naming one beats naming neither.
      const why = closed.find((w) => minutes < w.to && finishes > w.from)?.label;
      if (why) slot.note = why;
    } else if (booked.some((b) => overlaps(b, { start, end }))) {
      slot.available = false;
      slot.reason = 'booked';
    } else if (busy.some((b) => overlaps(b, { start, end }))) {
      // The room's own Google Calendar. Before SPC-14 nothing read it, so a
      // rehearsal put straight into the calendar left the slot showing free.
      slot.available = false;
      slot.reason = 'calendar';
    }

    slots.push(slot);
  }

  // A booking that runs past midnight is a different feature, and offering
  // starts that cannot finish inside the day would show times that always
  // fail. Trimmed here rather than marked, because there is nothing a member
  // could do about them.
  return slots.filter((s) => s.minutes + durationMinutes <= 24 * 60);
}

/** Whether a date has any bookable slot at all — the dot on the calendar. */
export function hasAnyOpening(query: SlotQuery): boolean {
  return slotsForDate(query).some((s) => s.available);
}
