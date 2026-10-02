import { importWindow, toEntry } from '../calendar-import';

/**
 * Reading a Google calendar into a co-op's own shape (CAL-02).
 *
 * Everything here is a guess about what somebody meant when they typed into
 * a box that was never a MaybeOS form, which is why it is tested without a
 * database or a Google client in the way. The failure these guard against is
 * not an exception: it is an event that lands on the wrong evening, or a
 * cancelled one that members are invited to attend.
 */

const TZ = 'America/New_York';

describe('a timed entry', () => {
  const raw = {
    id: 'evt_1',
    summary: '  Board Game Night  ',
    description: ' Bring a game. ',
    start: { dateTime: '2026-10-15T23:00:00Z' },
    end: { dateTime: '2026-10-16T01:00:00Z' },
    organizer: { email: 'Ada@Example.com ' },
    location: ' The Hall ',
  };

  it('keeps the instants Google gave, trimmed of their typing', () => {
    const entry = toEntry(raw, TZ);

    expect(entry?.title).toBe('Board Game Night');
    expect(entry?.description).toBe('Bring a game.');
    expect(entry?.start).toEqual(new Date('2026-10-15T23:00:00Z'));
    expect(entry?.end).toEqual(new Date('2026-10-16T01:00:00Z'));
    expect(entry?.location).toBe('The Hall');
  });

  it('lowercases the organiser, because that is how a member is found', () => {
    expect(toEntry(raw, TZ)?.organiserEmail).toBe('ada@example.com');
  });

  it('gives an entry with no end an hour rather than a negative length', () => {
    const entry = toEntry({ ...raw, end: undefined }, TZ);

    expect(entry?.end).toEqual(new Date('2026-10-16T00:00:00Z'));
  });
});

describe('an all-day entry', () => {
  it('starts at midnight where the co-op is, not at midnight UTC', () => {
    const entry = toEntry(
      { id: 'evt_2', summary: 'Open Studio', start: { date: '2026-10-15' }, end: { date: '2026-10-16' } },
      TZ,
    );

    // New York is four hours behind UTC in October. Read as a UTC instant,
    // this would start at 8pm on the 14th — the evening before, which is
    // exactly the kind of wrong nobody checks.
    expect(entry?.start.toISOString()).toBe('2026-10-15T04:00:00.000Z');
    expect(entry?.allDay).toBe(true);
  });

  it('reads Google’s exclusive end date as given', () => {
    const entry = toEntry(
      { id: 'evt_3', summary: 'Festival', start: { date: '2026-07-01' }, end: { date: '2026-07-04' } },
      TZ,
    );

    // Google says a three-day festival ends on the 4th; it does, at midnight.
    expect(entry?.end.toISOString()).toBe('2026-07-04T04:00:00.000Z');
  });

  it('gives a one-day entry with no end a full day', () => {
    const entry = toEntry({ id: 'evt_4', summary: 'Closed', start: { date: '2026-12-25' } }, TZ);

    const hours = (entry!.end.getTime() - entry!.start.getTime()) / 3_600_000;
    expect(hours).toBe(24);
  });
});

describe('what is not importable', () => {
  it('skips an entry with no start at all', () => {
    expect(toEntry({ id: 'evt_5', summary: 'Broken' }, TZ)).toBeNull();
  });

  it('skips an entry with no id, which cannot be matched on a re-run', () => {
    expect(toEntry({ summary: 'No id', start: { dateTime: '2026-10-15T23:00:00Z' } }, TZ)).toBeNull();
  });

  it('skips one that ends before it starts', () => {
    const entry = toEntry(
      {
        id: 'evt_6',
        summary: 'Backwards',
        start: { dateTime: '2026-10-15T23:00:00Z' },
        end: { dateTime: '2026-10-15T22:00:00Z' },
      },
      TZ,
    );

    expect(entry).toBeNull();
  });

  it('marks a cancelled entry rather than hiding it, so a re-run can act', () => {
    const entry = toEntry(
      {
        id: 'evt_7',
        summary: 'Called off',
        status: 'cancelled',
        start: { dateTime: '2026-10-15T23:00:00Z' },
        end: { dateTime: '2026-10-16T00:00:00Z' },
      },
      TZ,
    );

    expect(entry?.cancelled).toBe(true);
  });

  it('gives an untitled entry a name rather than a blank row', () => {
    const entry = toEntry(
      { id: 'evt_8', start: { dateTime: '2026-10-15T23:00:00Z' }, end: { dateTime: '2026-10-16T00:00:00Z' } },
      TZ,
    );

    expect(entry?.title).toBe('Untitled');
  });
});

describe('the window', () => {
  const now = new Date('2026-10-02T12:00:00Z');

  it('reaches a year back by default', () => {
    expect(importWindow(now, 12).from.toISOString().slice(0, 7)).toBe('2025-10');
  });

  it('stops two years ahead rather than reading forever', () => {
    // A standing weekly booking has an endless calendar, and "everything
    // ahead" would import recurrences until Google got bored.
    expect(importWindow(now, 12).to.toISOString().slice(0, 4)).toBe('2028');
  });

  it('can be asked for the future only', () => {
    expect(importWindow(now, 0).from.getTime()).toBe(now.getTime());
  });
});
