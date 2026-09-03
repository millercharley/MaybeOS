import { groupUpcoming, monthHeading, startsIn, whenLabel } from '@/lib/event-list';

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
