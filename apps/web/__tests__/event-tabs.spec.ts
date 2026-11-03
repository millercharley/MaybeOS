import { emptyNote, hasEnded, searchEvents, splitEvents } from '@/lib/event-tabs';

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
