import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../../../common/testing/source-scan';
import {
  DEFAULT_SCHEDULE,
  addDays,
  isDue,
  isoWeekday,
  sanitiseSchedule,
  weeklyWindow,
} from '../weekly-schedule';
import { instantAt, zonedParts } from '../../space/availability/zoned-time';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

/**
 * When the weekly post goes out, and what it covers (SOC-05).
 *
 * Charley: "The default is the image posts on Thursday mornings, listing
 * events from Thursday through the following Sunday (11 day horizon)."
 */
describe('the weekly schedule', () => {
  describe('the default Charley asked for', () => {
    it('is Thursday morning', () => {
      expect(DEFAULT_SCHEDULE).toEqual({ day: 4, hour: 9, days: 11 });
      expect(isoWeekday(4)).toBe(4);
    });

    /*
      Eleven, not seven. "Thursday through the following Sunday" is eleven
      days counting its own, and a week would stop four days short — on the
      Wednesday, missing the weekend the post exists to advertise.
    */
    it('reaches the following Sunday', () => {
      const span = weeklyWindow('2026-11-26', 11);

      expect(span.from).toBe('2026-11-26');
      expect(span.lastDay).toBe('2026-12-06');
      expect(span.toExclusive).toBe('2026-12-07');

      expect(new Date(`${span.from}T00:00:00Z`).getUTCDay()).toBe(4); // Thursday
      expect(new Date(`${span.lastDay}T00:00:00Z`).getUTCDay()).toBe(0); // Sunday
    });
  });

  describe('whether a co-op is due', () => {
    const thursday9 = { dayOfWeek: 4, minutes: 9 * 60 };

    it('is due on its day, in its hour', () => {
      expect(isDue(thursday9, DEFAULT_SCHEDULE)).toBe(true);
    });

    /*
      For the whole hour, not an instant. The scheduler runs every fifteen
      minutes, and a schedule that had to land on a minute would skip a week
      whenever a run was slow. Four runs answer true; the unique row is what
      makes one of them count.
    */
    it('is due for every run inside the hour', () => {
      for (const minute of [0, 15, 30, 45, 59]) {
        expect(isDue({ dayOfWeek: 4, minutes: 9 * 60 + minute }, DEFAULT_SCHEDULE)).toBe(true);
      }
    });

    it('is not due an hour either side', () => {
      expect(isDue({ dayOfWeek: 4, minutes: 8 * 60 + 59 }, DEFAULT_SCHEDULE)).toBe(false);
      expect(isDue({ dayOfWeek: 4, minutes: 10 * 60 }, DEFAULT_SCHEDULE)).toBe(false);
    });

    it('is not due on another day', () => {
      for (const dayOfWeek of [0, 1, 2, 3, 5, 6]) {
        expect(isDue({ dayOfWeek, minutes: 9 * 60 }, DEFAULT_SCHEDULE)).toBe(false);
      }
    });

    /** Sunday is 0 from `zonedParts` and 7 in ISO; getting this backwards
        would post on Monday for every co-op that chose Sunday. */
    it('speaks ISO weekdays, where Sunday is 7', () => {
      expect(isDue({ dayOfWeek: 0, minutes: 9 * 60 }, { day: 7, hour: 9, days: 11 })).toBe(true);
      expect(isDue({ dayOfWeek: 0, minutes: 9 * 60 }, { day: 1, hour: 9, days: 11 })).toBe(false);
    });
  });

  /**
   * The reason this file speaks in date strings.
   *
   * Every event is a UTC instant and this runs on a Lambda whose clock is
   * UTC. "Thursday at 9" is a sentence about where the co-op is, so the
   * bridge between the two is `zoned-time.ts`, which already handles the two
   * mornings a year when the offset changes.
   */
  describe('local dates, not local Dates', () => {
    it('adds days without a timezone anywhere near it', () => {
      expect(addDays('2026-11-26', 11)).toBe('2026-12-07');
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      // The leap day, which a naive +86400000 gets wrong.
      expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    });

    it('turns the window into instants that bracket the co-op’s own days', () => {
      const tz = 'America/New_York';
      const span = weeklyWindow('2026-11-26', 11);

      const from = instantAt(span.from, 0, tz);
      const toExclusive = instantAt(span.toExclusive, 0, tz);

      // Midnight in New York in November is 5am UTC.
      expect(from.toISOString()).toBe('2026-11-26T05:00:00.000Z');
      expect(toExclusive.toISOString()).toBe('2026-12-07T05:00:00.000Z');

      // An event at 11pm on the last Sunday is inside; the next morning is not.
      const lateSunday = new Date('2026-12-07T04:00:00.000Z');
      expect(lateSunday >= from && lateSunday < toExclusive).toBe(true);
      expect(new Date('2026-12-07T05:00:00.000Z') < toExclusive).toBe(false);
    });

    /*
      The morning the clocks go back, a co-op's day is 25 hours long. The
      window must still start at its midnight rather than an hour either
      side — `instantAt` does two passes for exactly this.
    */
    it('is right across a daylight saving change', () => {
      const tz = 'America/New_York';
      // US clocks go back on 1 November 2026.
      expect(instantAt('2026-10-31', 0, tz).toISOString()).toBe('2026-10-31T04:00:00.000Z');
      expect(instantAt('2026-11-02', 0, tz).toISOString()).toBe('2026-11-02T05:00:00.000Z');
    });

    it('reads a co-op’s weekday from the instant, in its own zone', () => {
      // 9am Thursday in New York.
      const parts = zonedParts(new Date('2026-11-26T14:00:00Z'), 'America/New_York');
      expect(isDue(parts, DEFAULT_SCHEDULE)).toBe(true);

      // The same instant is 1am Friday in Sydney, and not due there.
      const sydney = zonedParts(new Date('2026-11-26T14:00:00Z'), 'Australia/Sydney');
      expect(isDue(sydney, DEFAULT_SCHEDULE)).toBe(false);
    });
  });

  describe('settings somebody typed, or did not', () => {
    it('falls back where a value is out of range or missing', () => {
      expect(sanitiseSchedule(null)).toEqual(DEFAULT_SCHEDULE);
      expect(sanitiseSchedule({ day: 0 })).toMatchObject({ day: 4 });
      expect(sanitiseSchedule({ day: 8 })).toMatchObject({ day: 4 });
      expect(sanitiseSchedule({ hour: 24 })).toMatchObject({ hour: 9 });
      expect(sanitiseSchedule({ hour: -1 })).toMatchObject({ hour: 9 });
      expect(sanitiseSchedule({ days: 0 })).toMatchObject({ days: 11 });
      expect(sanitiseSchedule({ days: 400 })).toMatchObject({ days: 11 });
    });

    it('keeps what is in range, including the edges', () => {
      expect(sanitiseSchedule({ day: 7, hour: 0, days: 1 })).toEqual({ day: 7, hour: 0, days: 1 });
      expect(sanitiseSchedule({ day: 1, hour: 23, days: 31 })).toEqual({ day: 1, hour: 23, days: 31 });
    });
  });

  /** The file holds decisions; the service holds the queries and the API. */
  it('is pure', () => {
    const src = stripComments(read('weekly-schedule.ts'));
    expect(src).not.toMatch(/PrismaService|this\.prisma|fetch\(|Date\.now\(\)|new Date\(\)/);
  });
});
