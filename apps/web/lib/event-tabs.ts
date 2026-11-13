/**
 * Past events live behind their own tab, never below the upcoming ones
 * (EVT-49).
 *
 * Charley: "Always provide a second tab on any screen where previous events
 * are listed so that previous events all live together and are searchable,
 * not listed with upcoming events."
 *
 * A standing rule, so it is one function rather than three implementations.
 * The sweep that prompted it found three screens stacking a "Past" list under
 * a "Coming up" one — My Events, the Going panel inside it, and the admin
 * console's "All" tab — and each had arrived at its own slightly different
 * answer to the same two questions: which way to sort, and what counts as
 * past.
 *
 * **Past means it has ended, not that it has started.** An event in progress
 * is not a past event, and dropping it off the upcoming list at the moment it
 * begins is the opposite of useful — that is when somebody is most likely to
 * be looking for it. The same rule `listUserBookings` applies on the server
 * (SPC-23), which the admin console disagreed with: it compared `startTime`,
 * so an evening that started an hour ago had already moved to Past.
 */

export type EventTab = 'upcoming' | 'past';

export interface Timed {
  startTime: string;
  /** Absent on a few list shapes, which then fall back to the start. */
  endTime?: string | null;
}

/** Whether it is over. Measured from the end, so one in progress is not. */
export function hasEnded(event: Timed, now: Date = new Date()): boolean {
  return new Date(event.endTime ?? event.startTime) < now;
}

/**
 * The two lists, each sorted nearest to now (EVT-26).
 *
 * In opposite directions, which is the part worth writing down. The API hands
 * events back newest-first, which is right for a past list and backwards for
 * a future one: with 183 upcoming events — what a co-op looks like after
 * importing its calendar — "Coming up" opened on 2028 and buried tomorrow at
 * the bottom of the page.
 */
export function splitEvents<T>(
  events: T[],
  options: {
    now?: Date;
    /**
     * Where the dates are, when the row is not the event.
     *
     * An RSVP is a row about an event, and the times live a level down. The
     * default reads them off the row itself, which is every other caller.
     */
    timeOf?: (event: T) => Timed;
  } = {},
): { upcoming: T[]; past: T[] } {
  const now = options.now ?? new Date();
  const timeOf = options.timeOf ?? ((event: T) => event as unknown as Timed);

  const upcoming: T[] = [];
  const past: T[] = [];

  for (const event of events) {
    (hasEnded(timeOf(event), now) ? past : upcoming).push(event);
  }

  const start = (event: T) => timeOf(event).startTime;
  upcoming.sort((a, b) => start(a).localeCompare(start(b)));
  past.sort((a, b) => start(b).localeCompare(start(a)));

  return { upcoming, past };
}

/**
 * The same two tabs, for a list of *series* rather than a list of dates
 * (EVT-49, EVT-52).
 *
 * The sweep that made `splitEvents` a single function missed the one screen
 * that needed it most, and missed it for a reason worth writing down: the
 * host-transfer list is rows of series, not rows of events, so neither the
 * rule nor the guard that enforces it recognised the screen as a place where
 * events are listed. It was 287 rows with eight live ones somewhere in them.
 *
 * A series is upcoming when any single date of it still is — the one with an
 * evening ahead of it is the one where getting the host right still changes
 * something, even if the other forty-five are history.
 *
 * Order is kept as given for what is coming, because the server has already
 * sorted those by what matters. The past is turned newest-first, like every
 * other past list in the product: a series that ended last month is a better
 * guess at what somebody is looking for than one that ended in 2024.
 */
export function splitSeries<T extends { upcoming: number; lastStart: string }>(
  series: T[],
): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];

  for (const one of series) {
    (one.upcoming > 0 ? upcoming : past).push(one);
  }

  past.sort((a, b) => b.lastStart.localeCompare(a.lastStart));

  return { upcoming, past };
}

/**
 * Narrow a list by what somebody typed.
 *
 * Case-insensitive, and across whichever fields the caller says are worth
 * searching — the title everywhere, plus the room or the host where a screen
 * shows them. Trimmed, so a trailing space from a phone keyboard does not
 * empty the list.
 *
 * An empty box is not a filter. It returns the list it was given rather than
 * nothing, which is the bug this would otherwise be on first render.
 */
export function searchEvents<T>(
  events: T[],
  text: string,
  textOf: (event: T) => (string | null | undefined)[],
): T[] {
  const needle = text.trim().toLowerCase();
  if (!needle) return events;

  return events.filter((event) =>
    textOf(event).some((field) => (field ?? '').toLowerCase().includes(needle)),
  );
}

/** What the empty past list should say, which is not what an empty future says. */
export function emptyNote(tab: EventTab, searching: boolean): string {
  if (searching) return 'Nothing matches that.';

  return tab === 'past'
    ? 'Nothing here yet — events show up once they have happened.'
    : 'Nothing coming up.';
}
