import { zonedParts } from '../space/availability/zoned-time';

/**
 * What a tier asks of a member, and over what window (SRV-01).
 *
 * Two decisions live here, both of them fairness decisions rather than
 * technical ones.
 *
 * **Calendar windows, not anniversaries.** Everybody is measured over the same
 * week, month or year. Anniversary windows are defensible in isolation and
 * useless in aggregate: an organiser looking at "who is short" would be
 * reading forty private stopwatches, each measuring a different stretch of
 * time, and could not say a single true thing about the co-op.
 *
 * **The first window is prorated.** A member who joins on 20 December owes a
 * fortnight of a yearly expectation, not a year of it. Without this, every new
 * member arrives already in arrears, which is a poor first impression and a
 * number no organiser would act on anyway.
 */
export type ServicePeriod = 'WEEK' | 'MONTH' | 'YEAR';

export interface Window {
  /** First local date in the window, "YYYY-MM-DD". */
  from: string;
  /** Last local date, inclusive. */
  to: string;
}

const DAY = 86_400_000;

function shift(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY)
    .toISOString()
    .slice(0, 10);
}

function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
}

/**
 * The window `instant` falls in, in the co-op's timezone.
 *
 * Weeks run Sunday to Saturday, matching the `0 = Sunday` numbering the room
 * opening hours already use. One convention per codebase.
 */
export function currentWindow(
  period: ServicePeriod,
  instant: Date,
  timeZone: string,
): Window {
  const { date, dayOfWeek } = zonedParts(instant, timeZone);

  switch (period) {
    case 'WEEK': {
      const from = shift(date, -dayOfWeek);
      return { from, to: shift(from, 6) };
    }
    case 'MONTH': {
      const [year, month] = date.split('-').map(Number);
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return {
        from: `${date.slice(0, 7)}-01`,
        to: `${date.slice(0, 7)}-${String(last).padStart(2, '0')}`,
      };
    }
    case 'YEAR': {
      const year = date.slice(0, 4);
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    }
  }
}

/**
 * What this member owes in this window, in minutes.
 *
 * `null` when the tier asks for nothing, which is the default and true of
 * every tier that exists today — so the whole of Serve works without anybody
 * ever setting an expectation.
 */
export function expectedMinutes({
  tierMinutes,
  window,
  memberSince,
  timeZone,
}: {
  tierMinutes: number | null | undefined;
  window: Window;
  memberSince: Date;
  timeZone: string;
}): number | null {
  if (!tierMinutes || tierMinutes <= 0) return null;

  const joined = zonedParts(memberSince, timeZone).date;

  // Joined before this window opened: the whole expectation.
  if (joined <= window.from) return tierMinutes;
  // Joined after it closed — a future-dated membership. Nothing owed yet.
  if (joined > window.to) return 0;

  // Joined part way through: the share of the window they have been here for,
  // rounded to the nearest minute rather than up, so proration never invents
  // an obligation larger than the days it is scaled from.
  const share = daysInclusive(joined, window.to) / daysInclusive(window.from, window.to);
  return Math.round(tierMinutes * share);
}

/** How a member stands against their tier, for one window. */
export interface Standing {
  period: ServicePeriod;
  window: Window;
  /** Null when the tier asks for nothing. */
  expectedMinutes: number | null;
  servedMinutes: number;
  /** Minutes still owed, floored at zero. Null when nothing is expected. */
  shortfallMinutes: number | null;
  /** True when the expectation is prorated because they joined mid-window. */
  prorated: boolean;
}

export function standingFor({
  period,
  tierMinutes,
  servedMinutes,
  memberSince,
  timeZone,
  now,
}: {
  period: ServicePeriod;
  tierMinutes: number | null | undefined;
  servedMinutes: number;
  memberSince: Date;
  timeZone: string;
  now: Date;
}): Standing {
  const window = currentWindow(period, now, timeZone);
  const expected = expectedMinutes({ tierMinutes, window, memberSince, timeZone });
  const joined = zonedParts(memberSince, timeZone).date;

  return {
    period,
    window,
    expectedMinutes: expected,
    servedMinutes,
    shortfallMinutes: expected === null ? null : Math.max(0, expected - servedMinutes),
    prorated: expected !== null && joined > window.from && joined <= window.to,
  };
}
