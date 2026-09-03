import type { Closure } from '@/lib/api';

/**
 * How a closed period reads in a sentence (SPC-18).
 *
 * Pulled out because the cases are fiddly — one day or several, all day or
 * part of it — and each is a different sentence rather than a template with
 * blanks. "24 Dec – 2 Jan" and "25 Dec, 12:00–13:00" are both closures and
 * neither reads well as the other.
 */
export function closureLabel(closure: Closure): string {
  const from = dayLabel(closure.fromDate);
  const to = dayLabel(closure.toDate);

  const days = !from ? 'Unknown dates' : !to || to === from ? from : `${from} – ${to}`;

  return closure.allDay ? days : `${days}, ${closure.startTime}–${closure.endTime}`;
}

/** "25 Dec 2026", or the year dropped when it is this one. */
export function dayLabel(date: string | null, today = new Date()): string | null {
  if (!date) return null;

  const [year, month, day] = date.split('-').map(Number);
  const sameYear = year === today.getUTCFullYear();

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
