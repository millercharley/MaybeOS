import {
  dateLabel,
  durationLabel,
  localDate,
  monthGrid,
  monthLabel,
  monthOf,
  shiftMonth,
  timeLabel,
  zoneLabel,
} from '@/lib/booking-calendar';

/**
 * The month grid and its labels (SPC-15).
 *
 * Arithmetic with edge cases — leading blanks, year boundaries, midnight —
 * none of which is worth discovering through a rendered calendar.
 */
describe('monthGrid', () => {
  it('pads so the first lands under its weekday', () => {
    // 2026-09-01 is a Tuesday, so two blanks for Sunday and Monday.
    const cells = monthGrid('2026-09');

    expect(cells.slice(0, 2).every((c) => c.date === null)).toBe(true);
    expect(cells[2]).toEqual({ date: '2026-09-01', day: 1 });
  });

  it('covers every day of the month and no more', () => {
    expect(monthGrid('2026-09').filter((c) => c.date)).toHaveLength(30);
    expect(monthGrid('2026-02').filter((c) => c.date)).toHaveLength(28);
    expect(monthGrid('2028-02').filter((c) => c.date)).toHaveLength(29);
  });

  it('leaves neighbouring months out rather than greying them in', () => {
    // A greyed 31st of August under a September heading is something people
    // click, and then wonder why nothing happened.
    const cells = monthGrid('2026-09');

    expect(cells.every((c) => c.date === null || c.date.startsWith('2026-09'))).toBe(true);
  });

  it('starts a month that begins on Sunday with no padding', () => {
    // 2026-11-01 is a Sunday.
    expect(monthGrid('2026-11')[0]).toEqual({ date: '2026-11-01', day: 1 });
  });
});

describe('shiftMonth', () => {
  it('moves within a year', () => {
    expect(shiftMonth('2026-09', 1)).toBe('2026-10');
    expect(shiftMonth('2026-09', -1)).toBe('2026-08');
  });

  it('wraps across the year boundary', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});

describe('labels', () => {
  it('names the month and the date', () => {
    expect(monthLabel('2026-09')).toBe('September 2026');
    expect(dateLabel('2026-09-02')).toBe('Wednesday, September 2');
  });

  it('renders times the way a clock does', () => {
    expect(timeLabel(0)).toBe('12:00 am');
    expect(timeLabel(9 * 60)).toBe('09:00 am');
    expect(timeLabel(12 * 60)).toBe('12:00 pm');
    expect(timeLabel(16 * 60 + 30)).toBe('04:30 pm');
    expect(timeLabel(23 * 60 + 30)).toBe('11:30 pm');
  });

  it('names durations the way the chips read', () => {
    expect(durationLabel(30)).toBe('30 min');
    expect(durationLabel(60)).toBe('1 hour');
    expect(durationLabel(90)).toBe('1 h 30 min');
    expect(durationLabel(120)).toBe('2 hours');
    expect(durationLabel(180)).toBe('3 hours');
  });

  it('says whose clock these times are on', () => {
    // A member booking from another city has to know these are the building's
    // hours, not theirs — the difference between arriving on time and
    // arriving three hours early.
    const label = zoneLabel('America/New_York', new Date('2026-09-02T19:44:00Z'));

    expect(label).toContain('Eastern Daylight Time');
    expect(label).toContain('3:44 pm');
  });
});

describe('localDate', () => {
  it("gives the date in the room's zone, not the reader's", () => {
    // 01:00 UTC Thursday is still Wednesday in New York.
    expect(localDate(new Date('2026-09-03T01:00:00Z'), 'America/New_York')).toBe('2026-09-02');
  });

  it('reads the month off a date', () => {
    expect(monthOf('2026-09-02')).toBe('2026-09');
  });
});
