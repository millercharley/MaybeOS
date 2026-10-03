/**
 * How long a member may hold a room, and how much of it (SPC-29).
 *
 * Two different limits, often confused. One is about a single reservation —
 * three hours at a time keeps a room circulating. The other is about a
 * member's share of the building over a month or a year, which is a question
 * about fairness rather than about scheduling, and most co-ops never need to
 * ask it.
 *
 * Pure, because both produce a sentence somebody reads at the moment they are
 * refused, and that sentence is the feature.
 */

/** The longest any co-op may allow. Beyond this is moving in, not booking. */
export const SYSTEM_MAX_MINUTES = 24 * 60;

/** What a co-op gets without thinking about it. */
export const DEFAULT_MAX_MINUTES = 180;

export type QuotaPeriod = 'MONTH' | 'YEAR';

/**
 * The limit that actually applies to one room.
 *
 * The shorter of the co-op's and the room's. A darkroom with a queue knows
 * more about itself than the co-op does, and a co-op that shortens its limit
 * should not quietly lengthen a room's.
 */
export function effectiveMaxMinutes(
  orgMinutes: number | null | undefined,
  roomMinutes: number | null | undefined,
): number {
  const org = Math.min(orgMinutes || DEFAULT_MAX_MINUTES, SYSTEM_MAX_MINUTES);
  if (!roomMinutes) return org;

  return Math.min(org, roomMinutes);
}

/** "3 hours", "90 minutes", "1 hour" — whichever reads properly. */
export function describeMinutes(minutes: number): string {
  if (minutes % 60 !== 0) return `${minutes} minutes`;

  const hours = minutes / 60;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/**
 * The window a quota is counted over, as instants.
 *
 * A calendar month and a calendar year, in the co-op's own reckoning: a
 * rolling thirty days would mean a member's allowance creeps forward and
 * nobody can say when it resets. "You have four hours left this month" is
 * answerable; "in the last thirty days" is not.
 */
export function quotaWindow(period: QuotaPeriod, now: Date): { from: Date; to: Date } {
  const year = now.getUTCFullYear();

  if (period === 'YEAR') {
    return {
      from: new Date(Date.UTC(year, 0, 1)),
      to: new Date(Date.UTC(year + 1, 0, 1)),
    };
  }

  const month = now.getUTCMonth();
  return {
    from: new Date(Date.UTC(year, month, 1)),
    to: new Date(Date.UTC(year, month + 1, 1)),
  };
}

/**
 * Why a booking would take a member over their allowance, or null.
 *
 * Says what they have used and what is left, because "you have reached your
 * limit" with no number is a dead end — somebody needs to know whether to
 * book two hours instead of four, or to ask an organiser.
 */
export function quotaProblem(
  quota: { period: QuotaPeriod | null; hours: number | null },
  usedMinutes: number,
  requestedMinutes: number,
): string | null {
  if (!quota.period || !quota.hours) return null;

  const allowance = quota.hours * 60;
  if (usedMinutes + requestedMinutes <= allowance) return null;

  const left = Math.max(0, allowance - usedMinutes);
  const span = quota.period === 'MONTH' ? 'this month' : 'this year';

  if (left === 0) {
    return `You have used all ${quota.hours} hours of room time ${span}. Ask an organiser if you need more.`;
  }

  return (
    `That would take you past ${quota.hours} hours of room time ${span}. ` +
    `You have ${describeMinutes(left)} left — book a shorter slot, or ask an organiser.`
  );
}
