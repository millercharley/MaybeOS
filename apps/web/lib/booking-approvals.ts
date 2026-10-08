import type { PendingBooking } from './api';

/**
 * Reading a queue of room requests (SPC-32).
 *
 * Kept out of the component so the wording and the counting can be tested on
 * their own — and because the one number that matters here is "how many are
 * waiting on me", which is also what the nav badge shows.
 */

/**
 * How many are still worth acting on.
 *
 * A request for a date that has passed is still listed — somebody was left
 * waiting and that should be visible — but it does not belong in a badge
 * demanding attention, because approving it changes nothing for anybody.
 */
export function awaitingCount(pending: PendingBooking[]): number {
  return pending.filter((booking) => !booking.lapsed).length;
}

/** The heading above the queue. */
export function approvalSummary(pending: PendingBooking[]): string {
  const live = awaitingCount(pending);
  const lapsed = pending.length - live;

  if (live === 0) {
    return `${lapsed} room request${lapsed === 1 ? '' : 's'} went unanswered`;
  }

  const head = `${live} room request${live === 1 ? '' : 's'} waiting on you`;
  return lapsed > 0 ? `${head}, and ${lapsed} that already passed` : head;
}

/** When the room is wanted, in the reader's own timezone. */
export function whenLabel(booking: { startTime: string; endTime: string }): string {
  const start = new Date(booking.startTime);
  const end = new Date(booking.endTime);
  if (Number.isNaN(start.getTime())) return '';

  const day = start.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  return Number.isNaN(end.getTime())
    ? `${day}, ${time(start)}`
    : `${day}, ${time(start)}–${time(end)}`;
}
