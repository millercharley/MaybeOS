import {
  dueAt,
  isDue,
  missedItsMoment,
  minutesOfClock,
  GRACE_MINUTES,
  type BriefingRule,
} from '../briefing-schedule';

/**
 * When a host briefing goes out (SRV-03).
 *
 * The two defaults Charley specified are two different kinds of schedule, and
 * most of these tests exist to keep them from being collapsed into one.
 */
const NY = 'America/New_York';

const booking = {
  // 2 Sep 2026, 18:00–21:00 New York.
  startTime: new Date('2026-09-02T22:00:00.000Z'),
  endTime: new Date('2026-09-03T01:00:00.000Z'),
};

const rule = (over: Partial<BriefingRule> = {}): BriefingRule => ({
  anchor: 'CLOCK_ON_DAY',
  clockTime: '07:00',
  offsetMinutes: 60,
  ...over,
});

const localTime = (instant: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: NY,
    dateStyle: 'short',
    timeStyle: 'short',
    hour12: false,
  }).format(instant);

describe('minutesOfClock', () => {
  it('reads a clock time', () => {
    expect(minutesOfClock('07:00')).toBe(420);
    expect(minutesOfClock('18:30')).toBe(1110);
  });

  it('falls back to 7am rather than NaN', () => {
    // A NaN produces an Invalid Date, and every briefing silently stops.
    expect(minutesOfClock('breakfast')).toBe(420);
    expect(minutesOfClock('')).toBe(420);
  });
});

describe('dueAt', () => {
  it('puts a clock-time briefing at that hour on the booking’s own day', () => {
    // "The morning of their reserved room at 7am."
    expect(localTime(dueAt(rule(), booking, NY))).toBe('02/09/2026, 07:00');
  });

  it('keeps 7am at 7am across a daylight saving change', () => {
    // US clocks go back on 1 Nov 2026. An offset expressed in milliseconds
    // would make this 6am or 8am depending on the side.
    const november = {
      startTime: new Date('2026-11-02T23:00:00.000Z'), // 2 Nov, 18:00 NY (EST)
      endTime: new Date('2026-11-03T02:00:00.000Z'),
    };
    expect(localTime(dueAt(rule(), november, NY))).toBe('02/11/2026, 07:00');
  });

  it('puts an end-relative briefing an hour before the end', () => {
    // "1 hour before their event is scheduled to end."
    const due = dueAt(rule({ anchor: 'BEFORE_END', offsetMinutes: 60 }), booking, NY);
    expect(due.toISOString()).toBe('2026-09-03T00:00:00.000Z');
    expect(localTime(due)).toBe('02/09/2026, 20:00');
  });

  it('handles the other anchors relative to the right end of the booking', () => {
    expect(dueAt(rule({ anchor: 'BEFORE_START', offsetMinutes: 30 }), booking, NY).toISOString())
      .toBe('2026-09-02T21:30:00.000Z');
    expect(dueAt(rule({ anchor: 'AFTER_START', offsetMinutes: 15 }), booking, NY).toISOString())
      .toBe('2026-09-02T22:15:00.000Z');
    expect(dueAt(rule({ anchor: 'AFTER_END', offsetMinutes: 120 }), booking, NY).toISOString())
      .toBe('2026-09-03T03:00:00.000Z');
  });

  it('reads the booking’s day in the co-op’s timezone, not the server’s', () => {
    // A booking at 21:00 New York on 2 Sep is 01:00 UTC on the 3rd. A server
    // reading the date in UTC would send the "morning of" briefing on the
    // wrong day.
    const lateEvening = {
      startTime: new Date('2026-09-03T01:00:00.000Z'),
      endTime: new Date('2026-09-03T03:00:00.000Z'),
    };
    expect(localTime(dueAt(rule(), lateEvening, NY))).toBe('02/09/2026, 07:00');
  });
});

describe('isDue', () => {
  const due = new Date('2026-09-02T11:00:00.000Z');

  it('is not due before its moment', () => {
    expect(isDue(due, new Date('2026-09-02T10:59:00.000Z'))).toBe(false);
  });

  it('is due at its moment and through the grace window', () => {
    expect(isDue(due, due)).toBe(true);
    expect(isDue(due, new Date(due.getTime() + GRACE_MINUTES * 60_000))).toBe(true);
  });

  it('stops being due once the grace window closes', () => {
    // The guard that stops switching the feature on from mailing every host in
    // the co-op's history at once — every past booking is "due and unsent".
    expect(isDue(due, new Date(due.getTime() + (GRACE_MINUTES + 1) * 60_000))).toBe(false);
    expect(isDue(due, new Date('2027-01-01T00:00:00.000Z'))).toBe(false);
  });
});

describe('missedItsMoment', () => {
  it('skips a briefing the booking could never have received', () => {
    // Booked at 09:00 for that afternoon: the 7am "morning of" message
    // describes a moment that had already passed when the booking was made.
    const due = new Date('2026-09-02T11:00:00.000Z'); // 07:00 NY
    const bookedAt = new Date('2026-09-02T13:00:00.000Z'); // 09:00 NY
    expect(missedItsMoment(due, bookedAt)).toBe(true);
  });

  it('sends one the booking was made in time for', () => {
    const due = new Date('2026-09-02T11:00:00.000Z');
    const bookedAt = new Date('2026-08-20T13:00:00.000Z');
    expect(missedItsMoment(due, bookedAt)).toBe(false);
  });
});
