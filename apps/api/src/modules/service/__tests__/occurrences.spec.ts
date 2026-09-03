import {
  occurrencesBetween,
  nextOccurrences,
  minutesOfDay,
  DutyRule,
} from '../occurrences';

/**
 * When a duty comes round (SRV-01).
 *
 * The bug being guarded against is the one the room slots already taught this
 * codebase: stepping a recurring thing forward in milliseconds. 7 × 86,400,000
 * is a week only where there is no daylight saving, and "Tuesdays at nine"
 * quietly becomes Tuesdays at eight for half the year.
 */
const NY = 'America/New_York';

const rule = (over: Partial<DutyRule> = {}): DutyRule => ({
  recurrence: 'WEEKLY',
  startsOn: new Date('2026-03-03T05:00:00.000Z'), // Tue 3 Mar, midnight in NY
  endsOn: null,
  startTime: '09:00',
  ...over,
});

describe('minutesOfDay', () => {
  it('reads a clock time', () => {
    expect(minutesOfDay('09:30')).toBe(570);
    expect(minutesOfDay('00:00')).toBe(0);
    expect(minutesOfDay('23:59')).toBe(1439);
  });

  it('falls back to nine rather than to NaN', () => {
    // A NaN here does not throw, it produces an Invalid Date, and every
    // occurrence of the duty silently disappears from the list.
    expect(minutesOfDay('banana')).toBe(9 * 60);
    expect(minutesOfDay('')).toBe(9 * 60);
  });

  it('clamps rather than overflowing into the next day', () => {
    expect(minutesOfDay('99:99')).toBe(23 * 60 + 59);
  });
});

describe('occurrencesBetween', () => {
  it('gives a one-off exactly once', () => {
    const once = occurrencesBetween(
      rule({ recurrence: 'NONE' }),
      '2026-03-01',
      '2026-12-31',
      NY,
    );
    expect(once.map((o) => o.date)).toEqual(['2026-03-03']);
  });

  it('gives every Tuesday for a weekly duty', () => {
    const weeks = occurrencesBetween(rule(), '2026-03-01', '2026-03-31', NY);
    expect(weeks.map((o) => o.date)).toEqual([
      '2026-03-03',
      '2026-03-10',
      '2026-03-17',
      '2026-03-24',
      '2026-03-31',
    ]);
  });

  it('keeps nine o\'clock across the spring clock change', () => {
    // US clocks go forward on 8 March 2026. Stepping in milliseconds would
    // make every occurrence after it 08:00 local.
    const weeks = occurrencesBetween(rule(), '2026-03-01', '2026-03-31', NY);
    const local = weeks.map((o) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: NY,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(o.occursAt),
    );
    expect(new Set(local)).toEqual(new Set(['09:00']));
  });

  it('honours a duty that ends', () => {
    const ends = occurrencesBetween(
      rule({ endsOn: new Date('2026-03-18T04:00:00.000Z') }),
      '2026-03-01',
      '2026-12-31',
      NY,
    );
    expect(ends.map((o) => o.date)).toEqual([
      '2026-03-03',
      '2026-03-10',
      '2026-03-17',
    ]);
  });

  it('never looks before the duty starts', () => {
    const before = occurrencesBetween(rule(), '2026-01-01', '2026-02-28', NY);
    expect(before).toEqual([]);
  });

  it('counts a fortnight as fourteen days, not two calendar weeks', () => {
    const fortnight = occurrencesBetween(
      rule({ recurrence: 'BIWEEKLY' }),
      '2026-03-01',
      '2026-04-30',
      NY,
    );
    expect(fortnight.map((o) => o.date)).toEqual([
      '2026-03-03',
      '2026-03-17',
      '2026-03-31',
      '2026-04-14',
      '2026-04-28',
    ]);
  });

  it('skips a monthly day that does not exist rather than sliding it', () => {
    // The 31st: a duty an organiser set for the end of the month must not
    // turn up on 1 March, which is a different month from the one they chose.
    const monthly = occurrencesBetween(
      rule({
        recurrence: 'MONTHLY',
        startsOn: new Date('2026-01-31T05:00:00.000Z'),
      }),
      '2026-01-01',
      '2026-06-30',
      NY,
    );
    expect(monthly.map((o) => o.date)).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
    ]);
  });
});

describe('nextOccurrences', () => {
  it('stops after the count, for a duty that never ends', () => {
    const next = nextOccurrences(rule(), '2026-06-01', 3, NY);
    expect(next).toHaveLength(3);
    expect(next[0].date).toBe('2026-06-02');
  });

  it('returns nothing once a duty is over', () => {
    const done = rule({ endsOn: new Date('2026-03-18T04:00:00.000Z') });
    expect(nextOccurrences(done, '2026-06-01', 5, NY)).toEqual([]);
  });
});
