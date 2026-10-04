import { readFileSync } from 'fs';
import { join } from 'path';
import { eventWindow, groupUpcoming, monthHeading, startsIn, whenLabel } from '@/lib/event-list';

/**
 * How the events page is arranged (EVT-18).
 *
 * It was one flat run of cards, so the next thing happening looked exactly
 * like something in November.
 */
const NY = 'America/New_York';
const at = (iso: string) => ({ id: iso, startTime: iso });

describe('groupUpcoming', () => {
  const now = new Date('2026-09-02T12:00:00Z');

  it('pulls out the next event and groups the rest by month', () => {
    const { next, months } = groupUpcoming(
      [at('2026-10-05T18:00:00Z'), at('2026-09-03T23:00:00Z'), at('2026-09-20T18:00:00Z')],
      NY,
      now,
    );

    expect(next?.id).toBe('2026-09-03T23:00:00Z');
    expect(months.map((m) => m.heading)).toEqual(['September 2026', 'October 2026']);
  });

  it('does not repeat the next event inside its month', () => {
    // Showing it twice makes a quiet week look like two events.
    const { next, months } = groupUpcoming(
      [at('2026-09-03T23:00:00Z'), at('2026-09-20T18:00:00Z')],
      NY,
      now,
    );

    expect(months[0].events.map((e) => e.id)).not.toContain(next?.id);
  });

  it('leaves out what has already happened', () => {
    const { next, months } = groupUpcoming([at('2026-08-01T18:00:00Z')], NY, now);

    expect(next).toBeNull();
    expect(months).toEqual([]);
  });

  it('groups by the co-op\'s month, not the reader\'s', () => {
    // 2026-10-01T02:00Z is still 30 September in New York.
    expect(monthHeading('2026-10-01T02:00:00Z', NY)).toBe('September 2026');
  });
});

describe('startsIn', () => {
  const now = new Date('2026-09-02T12:00:00Z');

  it('counts hours for something tomorrow', () => {
    expect(startsIn('2026-09-03T11:00:00Z', now)).toBe('Starts in 23 hours');
  });

  it('counts minutes for something imminent', () => {
    expect(startsIn('2026-09-02T12:30:00Z', now)).toBe('Starts in 30 minutes');
  });

  it('says nothing about something months away', () => {
    // A countdown on every card makes the one that matters invisible.
    expect(startsIn('2027-01-01T12:00:00Z', now)).toBeNull();
  });

  it('says nothing about something that has started', () => {
    expect(startsIn('2026-09-02T11:00:00Z', now)).toBeNull();
  });
});

describe('whenLabel', () => {
  it('reads like the calendar does', () => {
    expect(whenLabel('2026-09-03T23:00:00Z', '2026-09-04T01:30:00Z', NY)).toBe(
      'Thursday, Sep 3, 7:00 PM – 9:30 PM EDT',
    );
  });

  it('names both days when an event runs past midnight', () => {
    // Otherwise it reads as ending before it began.
    expect(whenLabel('2026-09-03T23:00:00Z', '2026-09-04T05:00:00Z', NY)).toContain(
      'Friday, Sep 4',
    );
  });
});

/**
 * Which stretch of a co-op's calendar a list asks for (EVT-27).
 *
 * The events endpoint orders ascending from the beginning of a co-op's
 * history, twenty at a time, and every member-facing caller took the default.
 * That was invisible until MaybeItsFate imported 777 events: the dashboard
 * was then handed twenty evenings from November 2024 and said "Nothing on
 * today" while tonight's Improv Club sat on the calendar.
 */
describe('the window a list asks for', () => {
  const now = new Date('2026-10-02T19:30:00Z');

  it('starts at midnight, so late in the day still shows the whole day', () => {
    // A dashboard opened at 11pm must still show the thing that started at 7.
    const { from } = eventWindow(now, 0);

    expect(new Date(from).getHours()).toBe(0);
    expect(new Date(from).getMinutes()).toBe(0);
  });

  it('reaches back when a page shows a recent past', () => {
    const today = new Date(eventWindow(now, 0).from).getTime();
    const back = new Date(eventWindow(now, 90).from).getTime();

    expect(Math.round((today - back) / 86_400_000)).toBe(90);
  });

  it('asks for as many as the API will give', () => {
    // 100 is its ceiling. A co-op with more inside the window gets the
    // earliest of them, which is the right end to keep.
    expect(eventWindow(now, 0).perPage).toBe(100);
  });

  it('is an instant the API will accept', () => {
    expect(() => new Date(eventWindow(now, 30).from).toISOString()).not.toThrow();
    expect(eventWindow(now, 30).from).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('every member-facing list says which stretch it wants', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');

  it('the member dashboard asks for today onwards', () => {
    const page = read('app', '(app)', '(dashboard)', 'member', '[orgSlug]', 'page.tsx');

    expect(page).toMatch(/listVisible\(orgId, token, eventWindow\(new Date\(\), 0\)\)/);
  });

  it('the events page asks for today onwards, on both branches', () => {
    // It reached ninety days back while it still drew an "already happened"
    // list; EVT-28 removed that, so the past would only be discarded.
    const page = read('app', '(app)', 'portal', '[orgSlug]', 'events', 'page.tsx');

    // Both branches: a member sees MEMBERS_ONLY too, and a visitor does not.
    expect(page).toMatch(/listVisible\(org\.id, token, eventWindow\(new Date\(\), 0\)\)/);
    expect(page).toMatch(/listPublic\(org\.id, eventWindow\(new Date\(\), 0\)\)/);
  });
});

/**
 * The events page is for deciding what to come to (EVT-28).
 *
 * Charley: every row should be something a member can still say yes to. The
 * page carried an "Already happened" list, which offered an RSVP button that
 * cannot do anything — and after MaybeItsFate's 777-event import it offered
 * hundreds of them.
 */
describe('the portal events page', () => {
  const page = readFileSync(
    join(__dirname, '..', 'app', '(app)', 'portal', '[orgSlug]', 'events', 'page.tsx'),
    'utf8',
  );

  it('has no past list to render', () => {
    // The panel itself, not the comment above it explaining why it went.
    expect(page).not.toMatch(/past\.slice\(/);
    expect(page).not.toMatch(/<Panel title=\{<span[^>]*>Already happened/);
  });

  it('does not compute a past list at all', () => {
    expect(page).not.toMatch(/const past = /);
  });

  it('does not ask the API for the past it would only discard', () => {
    expect(page).toMatch(/eventWindow\(new Date\(\), 0\)/);
    expect(page).not.toMatch(/eventWindow\(new Date\(\), 90\)/);
  });

  it('still says when a calendar is genuinely empty', () => {
    // The empty state used to depend on the past list being empty too.
    expect(page).toMatch(/!next && months\.length === 0/);
    expect(page).toMatch(/Nothing on the calendar yet/);
  });
});

/**
 * What counts as still to come (EVT-29).
 *
 * This cut at the start time, so an event vanished from the page the moment
 * it began — which is roughly when somebody deciding whether to turn up is
 * looking at it. Charley: keep them visible until they end.
 */
describe('what counts as upcoming', () => {
  const now = new Date('2026-10-02T19:00:00Z');
  const event = (id: string, startTime: string, endTime: string) => ({ id, startTime, endTime });
  const ids = (months: { events: { id: string }[] }[]) =>
    months.flatMap((m) => m.events.map((e) => e.id));

  it('leaves out an event that has ended', () => {
    const { next, months } = groupUpcoming(
      [
        event('over', '2026-10-01T19:00:00Z', '2026-10-01T21:00:00Z'),
        event('soon', '2026-10-02T22:00:00Z', '2026-10-03T00:00:00Z'),
      ],
      'UTC',
      now,
    );

    expect(next?.id).toBe('soon');
    expect(ids(months)).not.toContain('over');
  });

  it('keeps one that is happening right now', () => {
    // A two-hour workshop that started twenty minutes ago is still something
    // you can go to.
    const { next } = groupUpcoming(
      [event('on-now', '2026-10-02T18:40:00Z', '2026-10-02T20:40:00Z')],
      'UTC',
      now,
    );

    expect(next?.id).toBe('on-now');
  });

  it('puts the one in progress before one that has not started', () => {
    const { next, months } = groupUpcoming(
      [
        event('later', '2026-10-02T22:00:00Z', '2026-10-03T00:00:00Z'),
        event('on-now', '2026-10-02T18:40:00Z', '2026-10-02T20:40:00Z'),
      ],
      'UTC',
      now,
    );

    expect(next?.id).toBe('on-now');
    expect(ids(months)).toEqual(['later']);
  });

  it('drops one the moment it actually ends', () => {
    const { next } = groupUpcoming(
      [event('just-over', '2026-10-02T17:00:00Z', '2026-10-02T19:00:00Z')],
      'UTC',
      now,
    );

    expect(next).toBeNull();
  });

  it('falls back to the start when nothing says how long it runs', () => {
    // The old behaviour, and the only honest answer without an end time.
    const { next } = groupUpcoming(
      [{ id: 'unknown-length', startTime: '2026-10-02T18:40:00Z' }],
      'UTC',
      now,
    );

    expect(next).toBeNull();
  });
});

describe('how an event in progress reads', () => {
  const now = new Date('2026-10-02T19:00:00Z');

  it('says it is on, not that it starts in no time', () => {
    // These stay on the page until they end (EVT-29), and "Starts in 0
    // minutes" is not what somebody deciding whether to walk over needs.
    expect(startsIn('2026-10-02T18:40:00Z', now, '2026-10-02T20:40:00Z')).toBe('On now');
  });

  it('says nothing once it has ended', () => {
    expect(startsIn('2026-10-02T17:00:00Z', now, '2026-10-02T18:00:00Z')).toBeNull();
  });

  it('still counts down to one that has not started', () => {
    expect(startsIn('2026-10-02T20:00:00Z', now, '2026-10-02T22:00:00Z')).toBe('Starts in 1 hour');
  });

  it('says nothing about a started event whose end is unknown', () => {
    expect(startsIn('2026-10-02T18:40:00Z', now)).toBeNull();
  });
});
