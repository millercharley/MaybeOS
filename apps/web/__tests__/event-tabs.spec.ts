import { emptyNote, hasEnded, searchEvents, splitEvents, splitSeries } from '@/lib/event-tabs';

/**
 * Past events behind their own tab (EVT-49).
 *
 * Charley: "Always provide a second tab on any screen where previous events
 * are listed so that previous events all live together and are searchable,
 * not listed with upcoming events."
 */

const NOW = new Date('2026-11-03T12:00:00Z');
const at = (start: string, end?: string) => ({ startTime: start, endTime: end ?? start });

describe('what counts as past', () => {
  it('is measured from the end, not the start', () => {
    // Started an hour ago, ends in two. The admin console compared
    // `startTime`, so an evening in progress had already moved to Past.
    expect(
      hasEnded(at('2026-11-03T11:00:00Z', '2026-11-03T14:00:00Z'), NOW),
    ).toBe(false);
  });

  it('is past once it has ended', () => {
    expect(hasEnded(at('2026-11-02T19:00:00Z', '2026-11-02T22:00:00Z'), NOW)).toBe(true);
  });

  it('falls back to the start when a list shape carries no end', () => {
    expect(hasEnded({ startTime: '2026-11-02T19:00:00Z' }, NOW)).toBe(true);
    expect(hasEnded({ startTime: '2026-12-02T19:00:00Z' }, NOW)).toBe(false);
  });

  it('treats a null end the same as a missing one', () => {
    expect(hasEnded({ startTime: '2026-11-02T19:00:00Z', endTime: null }, NOW)).toBe(true);
  });
});

describe('the two lists', () => {
  const events = [
    { id: 'next-year', ...at('2027-05-07T19:00:00Z', '2027-05-07T21:00:00Z') },
    { id: 'long-ago', ...at('2025-01-27T19:00:00Z', '2025-01-27T21:00:00Z') },
    { id: 'tomorrow', ...at('2026-11-04T19:00:00Z', '2026-11-04T21:00:00Z') },
    { id: 'last-week', ...at('2026-10-27T19:00:00Z', '2026-10-27T21:00:00Z') },
  ];

  it('separates them', () => {
    const { upcoming, past } = splitEvents(events, { now: NOW });

    expect(upcoming.map((e) => e.id)).toEqual(['tomorrow', 'next-year']);
    expect(past.map((e) => e.id)).toEqual(['last-week', 'long-ago']);
  });

  it('opens the future on the soonest, not on 2028', () => {
    // The API hands these back newest-first, so "Coming up" opened two years
    // out and buried tomorrow at the bottom of the page (EVT-26).
    expect(splitEvents(events, { now: NOW }).upcoming[0].id).toBe('tomorrow');
  });

  it('opens the past on the most recent', () => {
    expect(splitEvents(events, { now: NOW }).past[0].id).toBe('last-week');
  });

  it('keeps an event in progress in the upcoming list', () => {
    const live = { id: 'now', ...at('2026-11-03T11:00:00Z', '2026-11-03T14:00:00Z') };

    expect(splitEvents([live], { now: NOW }).upcoming.map((e) => e.id)).toEqual(['now']);
  });

  it('has two empty lists when there is nothing', () => {
    expect(splitEvents([], { now: NOW })).toEqual({ upcoming: [], past: [] });
  });

  it('can read the dates a level down, for a row about an event', () => {
    // An RSVP is a row about an event; the times live on the event.
    const rsvps = [
      { id: 'then', event: at('2025-01-27T19:00:00Z', '2025-01-27T21:00:00Z') },
      { id: 'soon', event: at('2026-11-04T19:00:00Z', '2026-11-04T21:00:00Z') },
    ];

    const { upcoming, past } = splitEvents(rsvps, {
      now: NOW,
      timeOf: (r) => r.event,
    });

    expect(upcoming.map((r) => r.id)).toEqual(['soon']);
    expect(past.map((r) => r.id)).toEqual(['then']);
  });

  it('does not mutate what it was given', () => {
    const given = [...events];
    splitEvents(given, { now: NOW });

    expect(given.map((e) => e.id)).toEqual(events.map((e) => e.id));
  });
});

describe('searching', () => {
  const events = [
    { title: 'Board Games Club', room: 'Attic' },
    { title: 'Ecstatic Dance', room: 'Main Gallery' },
  ];
  const fields = (e: (typeof events)[number]) => [e.title, e.room];

  it('matches part of a title, whatever the case', () => {
    expect(searchEvents(events, 'board', fields)).toHaveLength(1);
    expect(searchEvents(events, 'BOARD', fields)).toHaveLength(1);
  });

  it('searches the other fields a screen shows', () => {
    expect(searchEvents(events, 'attic', fields)[0].title).toBe('Board Games Club');
  });

  it('ignores a trailing space from a phone keyboard', () => {
    expect(searchEvents(events, 'dance ', fields)).toHaveLength(1);
  });

  it('returns everything for an empty box, rather than nothing', () => {
    // The bug this would otherwise be on first render.
    expect(searchEvents(events, '', fields)).toHaveLength(2);
    expect(searchEvents(events, '   ', fields)).toHaveLength(2);
  });

  it('returns nothing when nothing matches', () => {
    expect(searchEvents(events, 'zzz', fields)).toHaveLength(0);
  });

  it('copes with a field that is missing', () => {
    expect(searchEvents([{ title: null }], 'x', (e) => [e.title])).toHaveLength(0);
  });
});

describe('what an empty list says', () => {
  it('says something different about the past than about the future', () => {
    expect(emptyNote('past', false)).not.toBe(emptyNote('upcoming', false));
  });

  it('blames the search when there is one', () => {
    expect(emptyNote('past', true)).toMatch(/matches/);
    expect(emptyNote('upcoming', true)).toMatch(/matches/);
  });
});

describe('the same two tabs over series rather than dates', () => {
  /**
   * The host-transfer screen (EVT-52). MaybeItsFate's list is 287 series of
   * which eight have a date still to come, and those eight are the whole live
   * problem: a member who cannot edit next Tuesday's event. The other 279
   * ended, some in 2024, and were sharing one scroll with them.
   */
  const series = (title: string, upcoming: number, lastStart: string) => ({
    title,
    upcoming,
    lastStart,
  });

  it('calls a series upcoming when any single date of it still is', () => {
    // Forty-six Board Games Clubs, twenty-four of them ahead. Forty-five
    // being history does not make the series history.
    const { upcoming, past } = splitSeries([
      series('Board Games Club', 24, '2028-10-29'),
      series('Writing Club', 0, '2025-10-20'),
    ]);

    expect(upcoming.map((s) => s.title)).toEqual(['Board Games Club']);
    expect(past.map((s) => s.title)).toEqual(['Writing Club']);
  });

  it('leaves what is coming in the order it was given', () => {
    // The server already sorted these by what is still to come and then by
    // size. Re-sorting here would throw that away.
    const { upcoming } = splitSeries([
      series('Potluck', 24, '2028-10-15'),
      series('Game Night', 23, '2028-10-10'),
      series('Art Improv', 1, '2026-12-20'),
    ]);

    expect(upcoming.map((s) => s.title)).toEqual(['Potluck', 'Game Night', 'Art Improv']);
  });

  it('turns the finished list newest-first', () => {
    // A series that ended last month is a better guess at what somebody is
    // looking for than one that ended two years ago.
    const { past } = splitSeries([
      series('MELT Restore Class', 0, '2025-01-30'),
      series('Sewcial Hour', 0, '2026-05-19'),
      series('Tea Time', 0, '2025-03-28'),
    ]);

    expect(past.map((s) => s.title)).toEqual([
      'Sewcial Hour',
      'Tea Time',
      'MELT Restore Class',
    ]);
  });

  it('puts every series in exactly one of the two lists', () => {
    const all = [
      series('a', 2, '2028-01-01'),
      series('b', 0, '2025-01-01'),
      series('c', 1, '2027-01-01'),
      series('d', 0, '2024-01-01'),
    ];
    const { upcoming, past } = splitSeries(all);

    expect(upcoming.length + past.length).toBe(all.length);
    expect(new Set([...upcoming, ...past]).size).toBe(all.length);
  });

  it('handles an empty list without inventing a tab', () => {
    expect(splitSeries([])).toEqual({ upcoming: [], past: [] });
  });
});
