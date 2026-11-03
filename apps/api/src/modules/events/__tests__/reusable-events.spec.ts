import { CARRIED_FIELDS, mostRecentPerTitle } from '../reusable-events';

/**
 * Reusing a previous event to fill in a new one (EVT-48).
 *
 * Charley: "When there are events with the exact same title, consider this the
 * same event and simply provide the most recent event as the option to select
 * (instead of showing a list of the same title that could be 40 events long)."
 *
 * Board Games Club is 46 events in MaybeItsFate; Ecstatic Dance ~ 1st Sundays
 * is 37.
 */

const on = (iso: string) => new Date(iso);
const event = (id: string, title: string, iso: string) => ({
  id,
  title,
  startTime: on(iso),
});

describe('one row per title', () => {
  it('collapses forty-six dates into one option', () => {
    const club = Array.from({ length: 46 }, (_, i) =>
      event(`e-${i}`, 'Board Games Club', `2026-0${(i % 9) + 1}-01T19:00:00Z`),
    );

    expect(mostRecentPerTitle(club)).toHaveLength(1);
  });

  it('keeps the most recent of them', () => {
    const picked = mostRecentPerTitle([
      event('old', 'Board Games Club', '2025-01-27T19:00:00Z'),
      event('newest', 'Board Games Club', '2028-10-29T19:00:00Z'),
      event('middle', 'Board Games Club', '2026-11-10T19:00:00Z'),
    ]);

    expect(picked.map((e) => e.id)).toEqual(['newest']);
  });

  it('does not assume the input was sorted', () => {
    // A sort order is a thing a later edit can change without noticing what
    // depended on it.
    const picked = mostRecentPerTitle([
      event('middle', 'Improv Club', '2026-11-10T19:00:00Z'),
      event('newest', 'Improv Club', '2027-05-07T19:00:00Z'),
      event('old', 'Improv Club', '2026-08-16T19:00:00Z'),
    ]);

    expect(picked.map((e) => e.id)).toEqual(['newest']);
  });

  it('keeps separate titles apart', () => {
    const picked = mostRecentPerTitle([
      event('a', 'Board Games Club', '2026-11-10T19:00:00Z'),
      event('b', 'Improv Club', '2026-11-11T19:00:00Z'),
    ]);

    expect(picked).toHaveLength(2);
  });

  it('puts the newest title first', () => {
    const picked = mostRecentPerTitle([
      event('a', 'Board Games Club', '2026-11-10T19:00:00Z'),
      event('b', 'Improv Club', '2027-05-07T19:00:00Z'),
      event('c', 'Hatha Yoga', '2025-11-14T19:00:00Z'),
    ]);

    expect(picked.map((e) => e.title)).toEqual([
      'Improv Club',
      'Board Games Club',
      'Hatha Yoga',
    ]);
  });

  it('has nothing to collapse when there is nothing', () => {
    expect(mostRecentPerTitle([])).toEqual([]);
  });
});

describe('what counts as the same title', () => {
  it('ignores case', () => {
    expect(
      mostRecentPerTitle([
        event('a', 'Board Games Club', '2026-11-10T19:00:00Z'),
        event('b', 'board games club', '2027-01-10T19:00:00Z'),
      ]),
    ).toHaveLength(1);
  });

  it('ignores surrounding space', () => {
    expect(
      mostRecentPerTitle([
        event('a', 'Tea Time', '2026-11-10T19:00:00Z'),
        event('b', '  Tea Time ', '2027-01-10T19:00:00Z'),
      ]),
    ).toHaveLength(1);
  });

  it('keeps the title as it was written, not the lowercased key', () => {
    const [picked] = mostRecentPerTitle([
      event('a', 'board games club', '2025-11-10T19:00:00Z'),
      event('b', 'Board Games Club', '2027-01-10T19:00:00Z'),
    ]);

    expect(picked.title).toBe('Board Games Club');
  });

  it('does not merge two things the co-op actually runs', () => {
    /*
      "Figure drawing" and "Figure Drawing with Chris Manzo" are both real
      MaybeItsFate events. Collapsing them on a prefix or a similarity score
      would hide the one somebody is looking for behind the one they are not.
    */
    const picked = mostRecentPerTitle([
      event('a', 'Figure drawing', '2027-01-03T19:00:00Z'),
      event('b', 'Figure Drawing with Chris Manzo', '2026-05-31T19:00:00Z'),
    ]);

    expect(picked).toHaveLength(2);
  });

  it('does not merge a series with its near-namesakes', () => {
    // Four real spellings from one co-op's calendar, which are four rows.
    const picked = mostRecentPerTitle([
      event('a', 'Ecstatic Dance ~ 1st Sundays', '2028-10-01T19:00:00Z'),
      event('b', 'Ecstatic Dance ~ First Sunday', '2027-04-04T19:00:00Z'),
      event('c', 'Ecstatic Dance ~ 3rd Sunday', '2026-08-16T19:00:00Z'),
      event('d', 'Ecstatic Dance Louisville', '2027-08-15T19:00:00Z'),
    ]);

    expect(picked).toHaveLength(4);
  });
});

describe('what a reused event carries', () => {
  it('does not carry when it is or where it is', () => {
    // The two answers that are never the same twice: a copy of last month's
    // date is a mistake somebody has to notice, and a room is exclusive.
    for (const field of ['startTime', 'endTime', 'roomId', 'bookingIds', 'locationId']) {
      expect(CARRIED_FIELDS).not.toContain(field);
    }
  });

  it('does not carry who ran it', () => {
    // This list includes events they only co-hosted (EVT-04), so copying the
    // host would quietly make somebody else's event again.
    expect(CARRIED_FIELDS).not.toContain('hostId');
  });

  it('carries the rest of what the form asks', () => {
    for (const field of [
      'title',
      'description',
      'visibility',
      'capacity',
      'tags',
      'priceCents',
      'hasCost',
      'maturityLevel',
      'imageUrl',
    ]) {
      expect(CARRIED_FIELDS).toContain(field);
    }
  });
});
