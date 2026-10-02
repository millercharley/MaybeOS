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
  /**
   * Optional, because not every caller of `monthHeading` has one. Where it is
   * present, it is what decides whether an event is over (EVT-29).
   */
  endTime?: string;
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
 *
 * **Over means ended, not started** (EVT-29). This cut at `startTime`, so
 * tonight's event disappeared from the events page at the moment it began —
 * which is roughly when somebody deciding whether to turn up is looking at
 * it. A two-hour workshop that started twenty minutes ago is still something
 * you can go to; one that finished last night is not.
 *
 * An event with no `endTime` falls back to its start, which is the old
 * behaviour and the only honest answer when nothing says how long it runs.
 */
export function groupUpcoming<T extends Listable>(
  events: T[],
  timeZone: string,
  now: Date,
): { next: T | null; months: { heading: string; events: T[] }[] } {
  const upcoming = events
    .filter((e) => new Date(e.endTime ?? e.startTime) > now)
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
export function startsIn(iso: string, now: Date, endIso?: string): string | null {
  const minutes = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000);

  // Already going (EVT-29). These stay on the page until they end, and
  // "Starts in 0 minutes" is not what somebody deciding whether to walk over
  // needs to read.
  if (minutes <= 0) {
    if (!endIso) return null;
    return new Date(endIso) > now ? 'On now' : null;
  }
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

/** The calendar day an instant falls on, in a given timezone. "2026-09-04". */
function dayIn(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(iso));
}

export interface Datable {
  id: string;
  startTime: string;
  endTime: string;
}

/**
 * What is on at the co-op today (DSH-01).
 *
 * Charley: the top of the member dashboard should headline what is going on at
 * the community in general, showing today's events.
 *
 * Three decisions, and each one is the difference between a useful line and a
 * misleading one:
 *
 * - **Today is the co-op's today**, not the reader's. A member reading this in
 *   another timezone is asking what is happening at the space, and at 10pm in
 *   California "tonight in New York" is already tomorrow.
 * - **Something already over is not on today.** A dashboard opened at 8pm
 *   listing this morning's meeting as what is going on is answering a question
 *   nobody asked.
 * - **Something running now counts even if it started yesterday.** An event
 *   that began at 10pm and runs past midnight is happening; excluding it
 *   because its start date reads as yesterday would hide the one thing on.
 */
export function happeningToday<T extends Datable>(
  events: T[],
  timeZone: string,
  now: Date,
): T[] {
  const today = dayIn(now, timeZone);

  return events
    .filter((e) => {
      const ends = new Date(e.endTime).getTime();
      if (ends <= now.getTime()) return false; // already over
      return dayIn(e.startTime, timeZone) === today || new Date(e.startTime) <= now;
    })
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/**
 * The window a list of events should ask the API for (EVT-27).
 *
 * The events endpoint orders ascending from the beginning of a co-op's
 * history, twenty at a time. That was invisible until MaybeItsFate imported
 * 777 events: every caller then received twenty evenings from November 2024,
 * and the member dashboard said "Nothing on today" with tonight's event
 * sitting on the calendar.
 *
 * So a caller says which stretch it is drawing. `daysBack` exists because
 * the Events page shows a recent past alongside what is coming; a dashboard
 * asking only about today passes 0.
 */
export function eventWindow(now: Date, daysBack: number): { from: string; perPage: number } {
  const from = new Date(now);
  from.setDate(from.getDate() - daysBack);
  // Midnight, so "today" is the whole of today however late it is read — a
  // dashboard opened at 11pm must still show the thing that started at 7.
  from.setHours(0, 0, 0, 0);

  return {
    from: from.toISOString(),
    // The API's ceiling. A co-op with more than a hundred events inside its
    // window gets the earliest of them, which is the right end to keep: the
    // next thing on is what every one of these lists is for.
    perPage: 100,
  };
}

/**
 * Which stretch an organiser's console asks for, per tab (EVT-27).
 *
 * The admin Events page filtered its tabs over whatever the API's default
 * page happened to hold — twenty events, ascending from the start of the
 * co-op's history. With 777 imported events, Upcoming filtered twenty
 * evenings from November 2024 and found none, on the one page whose job is
 * showing an organiser their events.
 *
 * Drafts are the exception: an unpublished event is as likely to be in the
 * past as the future — that is often why it is still a draft — so that tab
 * asks for the lot and filters here.
 */
export function adminEventWindow(
  tab: 'all' | 'upcoming' | 'past' | 'draft',
  now: Date,
): { from?: string; to?: string; perPage: number } {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);

  if (tab === 'upcoming') return { from: midnight.toISOString(), perPage: 100 };
  if (tab === 'past') return { to: now.toISOString(), perPage: 100 };

  return { perPage: 100 };
}
