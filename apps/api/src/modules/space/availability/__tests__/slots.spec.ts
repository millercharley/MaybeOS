import {
  durationsFor,
  hasAnyOpening,
  slotsForDate,
  type Rule,
  type SlotQuery,
} from '../slots';

/**
 * What a member can book, slot by slot (SPC-15).
 *
 * The booking screen shows every candidate time and crosses out the taken
 * ones, so the reason a slot is unavailable has to reach the UI. The API could
 * previously only refuse after the fact, which tells a member their choice was
 * wrong once they have made it and nothing about which choice would work.
 */
describe('slotsForDate', () => {
  const NY = 'America/New_York';
  const DATE = '2026-09-02'; // a Wednesday

  /** 2026-09-02 at `h`:00 Eastern, as a UTC instant. */
  const at = (h: number, m = 0) =>
    new Date(Date.UTC(2026, 8, 2, h + 4, m)); // EDT is UTC-4

  const openHours: Rule = {
    dayOfWeek: null,
    startTime: '09:00',
    endTime: '17:00',
    isBlackout: false,
    effectiveFrom: null,
    effectiveTo: null,
  };

  const query = (over: Partial<SlotQuery> = {}): SlotQuery => ({
    date: DATE,
    timeZone: NY,
    durationMinutes: 60,
    alwaysAvailable: false,
    rules: [openHours],
    booked: [],
    busy: [],
    now: at(0),
    ...over,
  });

  const free = (slots: ReturnType<typeof slotsForDate>) =>
    slots.filter((s) => s.available).map((s) => s.minutes);

  it('offers only slots inside the published hours', () => {
    const slots = slotsForDate(query());

    // 09:00 through a 16:00 start, which is the last that finishes by 17:00.
    expect(free(slots)[0]).toBe(9 * 60);
    expect(free(slots).at(-1)).toBe(16 * 60);
  });

  it('will not offer a slot that runs past closing', () => {
    const slots = slotsForDate(query({ durationMinutes: 120 }));

    // The last two-hour booking has to start at 15:00, not 16:00.
    expect(free(slots).at(-1)).toBe(15 * 60);
  });

  it('reports closed times rather than hiding them', () => {
    // A list that omits them looks like a quiet day rather than a shut one.
    const slots = slotsForDate(query());
    const eightAm = slots.find((s) => s.minutes === 8 * 60);

    expect(eightAm).toMatchObject({ available: false, reason: 'closed' });
  });

  it('interprets the hours in the co-op\'s timezone, not UTC', () => {
    const slots = slotsForDate(query());
    const nineAmLocal = slots.find((s) => s.minutes === 9 * 60);

    // 9am Eastern is 13:00 UTC. Comparing UTC hours against "09:00" made this
    // 9am UTC — 5am for the members actually standing outside the door.
    expect(nineAmLocal?.start.toISOString()).toBe('2026-09-02T13:00:00.000Z');
    expect(nineAmLocal?.available).toBe(true);
  });

  it('crosses out time that has already gone', () => {
    const slots = slotsForDate(query({ now: at(11, 30) }));

    expect(slots.find((s) => s.minutes === 10 * 60)).toMatchObject({
      available: false,
      reason: 'past',
    });
    expect(slots.find((s) => s.minutes === 12 * 60)?.available).toBe(true);
  });

  it('counts a slot as still bookable until it ends', () => {
    // At 11:30, the 11:00 hour has not finished. Marking it past would refuse
    // a member walking in to use the last half hour of it.
    const slots = slotsForDate(query({ now: at(11, 30) }));

    expect(slots.find((s) => s.minutes === 11 * 60)?.available).toBe(true);
  });

  it('crosses out an existing booking', () => {
    const slots = slotsForDate(query({ booked: [{ start: at(13), end: at(15) }] }));

    expect(slots.find((s) => s.minutes === 13 * 60)).toMatchObject({
      available: false,
      reason: 'booked',
    });
    expect(slots.find((s) => s.minutes === 12 * 60)?.available).toBe(true);
  });

  it('crosses out what the room\'s Google Calendar says is busy', () => {
    const slots = slotsForDate(query({ busy: [{ start: at(14), end: at(16) }] }));

    expect(slots.find((s) => s.minutes === 14 * 60)).toMatchObject({
      available: false,
      reason: 'calendar',
    });
  });

  it('lets a booking start exactly when another ends', () => {
    const slots = slotsForDate(query({ booked: [{ start: at(13), end: at(14) }] }));

    // Back-to-back is not a clash, and refusing it costs a co-op every second
    // slot of the day.
    expect(slots.find((s) => s.minutes === 14 * 60)?.available).toBe(true);
  });

  it('honours a blackout inside opening hours', () => {
    const slots = slotsForDate(
      query({
        rules: [
          openHours,
          {
            ...openHours,
            startTime: '12:00',
            endTime: '13:00',
            isBlackout: true,
          },
        ],
      }),
    );

    expect(slots.find((s) => s.minutes === 12 * 60)).toMatchObject({
      available: false,
      reason: 'blackout',
    });
  });

  it('treats blackout-only rules as open except those times', () => {
    const slots = slotsForDate(
      query({
        rules: [{ ...openHours, startTime: '12:00', endTime: '13:00', isBlackout: true }],
      }),
    );

    expect(slots.find((s) => s.minutes === 7 * 60)?.available).toBe(true);
    expect(slots.find((s) => s.minutes === 12 * 60)?.available).toBe(false);
  });

  it('offers nothing for a room whose hours nobody has set', () => {
    // Not the same as open around the clock. Those were one state until
    // SPC-05, and an unfinished room was bookable at 3am.
    expect(slotsForDate(query({ rules: [] }))).toEqual([]);
  });

  it('opens every hour for a room marked always available', () => {
    const slots = slotsForDate(query({ rules: [], alwaysAvailable: true }));

    expect(free(slots)[0]).toBe(0);
    // 48 half-hour starts in a day, less the 23:30 one, which cannot fit an
    // hour before midnight.
    expect(slots).toHaveLength(47);
    expect(slots.at(-1)?.minutes).toBe(23 * 60);
  });

  it('applies a weekday rule only on that weekday', () => {
    const mondaysOnly: Rule = { ...openHours, dayOfWeek: 1 };

    // 2026-09-02 is a Wednesday.
    expect(free(slotsForDate(query({ rules: [mondaysOnly] })))).toEqual([]);
    expect(
      free(slotsForDate(query({ date: '2026-09-07', rules: [mondaysOnly] }))).length,
    ).toBeGreaterThan(0);
  });

  it('does not offer a start that cannot finish before midnight', () => {
    const slots = slotsForDate(
      query({ rules: [], alwaysAvailable: true, durationMinutes: 180 }),
    );

    // A booking running past midnight is a different feature; offering starts
    // that always fail would be worse than not offering them.
    expect(slots.at(-1)?.minutes).toBe(21 * 60);
  });

  it('reports the reason a member would find most useful', () => {
    // Both past and booked: saying "already booked" about yesterday is true
    // and useless.
    const slots = slotsForDate(
      query({ now: at(16), booked: [{ start: at(10), end: at(11) }] }),
    );

    expect(slots.find((s) => s.minutes === 10 * 60)?.reason).toBe('past');
  });
});

describe('hasAnyOpening', () => {
  const base: SlotQuery = {
    date: '2026-09-02',
    timeZone: 'America/New_York',
    durationMinutes: 60,
    alwaysAvailable: false,
    rules: [
      {
        dayOfWeek: null,
        startTime: '09:00',
        endTime: '17:00',
        isBlackout: false,
        effectiveFrom: null,
        effectiveTo: null,
      },
    ],
    booked: [],
    busy: [],
    now: new Date('2026-09-02T00:00:00Z'),
  };

  it('marks a day with room left', () => {
    expect(hasAnyOpening(base)).toBe(true);
  });

  it('does not mark a day that is entirely taken', () => {
    expect(
      hasAnyOpening({
        ...base,
        booked: [
          {
            start: new Date('2026-09-02T13:00:00Z'),
            end: new Date('2026-09-02T21:00:00Z'),
          },
        ],
      }),
    ).toBe(false);
  });
});

describe('durationsFor', () => {
  it('offers the full set when a room sets no cap', () => {
    expect(durationsFor(null)).toEqual([30, 60, 90, 120, 180]);
  });

  it('stops at the cap', () => {
    expect(durationsFor(120)).toEqual([30, 60, 90, 120]);
  });

  it('keeps only what fits when the cap falls between choices', () => {
    // Offering an hour and then refusing it is worse than offering less.
    expect(durationsFor(45)).toEqual([30]);
  });

  it('offers the cap itself when it is shorter than every choice', () => {
    expect(durationsFor(20)).toEqual([20]);
  });
});
