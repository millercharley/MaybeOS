/**
 * Arranging events the way somebody reads them (EVT-18).
 *
 * The list was one flat run of cards under "Events", so the next thing
 * happening looked exactly like something in November. What a member wants
 * from this page, in order, is: what is on next, and then what is coming — and
 * that ordering is the layout rather than a sort.
 */

export interface Listable {
  id: string;
  startTime: string;
}

/** "September 2026", in the co-op's timezone rather than the reader's. */
export function monthHeading(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(new Date(iso));
}

/**
 * Upcoming events grouped by month, in order, with the next one pulled out.
 *
 * The next event is removed from its group rather than repeated: showing it
 * twice makes a quiet week look like two events.
 */
export function groupUpcoming<T extends Listable>(
  events: T[],
  timeZone: string,
  now: Date,
): { next: T | null; months: { heading: string; events: T[] }[] } {
  const upcoming = events
    .filter((e) => new Date(e.startTime) > now)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const [next = null, ...rest] = upcoming;

  const months: { heading: string; events: T[] }[] = [];
  for (const event of rest) {
    const heading = monthHeading(event.startTime, timeZone);
    const last = months[months.length - 1];

    if (last?.heading === heading) last.events.push(event);
    else months.push({ heading, events: [event] });
  }

  return { next, months };
}

/**
 * How soon, in words — "Starts in 23 hours".
 *
 * Only for things close enough that the answer changes what somebody does
 * today. "Starts in 4 months" is a fact nobody acts on, and a countdown on
 * every card makes the one that matters invisible.
 */
export function startsIn(iso: string, now: Date): string | null {
  const minutes = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000);

  if (minutes < 0) return null;
  if (minutes < 60) return `Starts in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Starts in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;

  const days = Math.round(hours / 24);
  return days <= 14 ? `Starts in ${days} days` : null;
}

/** "Thursday, Sep 3, 7:00 – 9:30 PM EDT", in the event's own timezone. */
export function whenLabel(startIso: string, endIso: string, timeZone: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);

  const day = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(start);

  const time = (d: Date, withZone: boolean) =>
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone,
      ...(withZone ? { timeZoneName: 'short' } : {}),
    }).format(d);

  const sameDay =
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(start) ===
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(end);

  // Spanning midnight needs both dates, or an event reads as ending nine hours
  // before it began.
  return sameDay
    ? `${day}, ${time(start, false)} – ${time(end, true)}`
    : `${day}, ${time(start, false)} – ${new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        timeZone,
      }).format(end)}, ${time(end, true)}`;
}
