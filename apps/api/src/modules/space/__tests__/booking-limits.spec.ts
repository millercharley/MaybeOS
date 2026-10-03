import {
  DEFAULT_MAX_MINUTES,
  SYSTEM_MAX_MINUTES,
  describeMinutes,
  effectiveMaxMinutes,
  quotaProblem,
  quotaWindow,
} from '../booking-limits';

/**
 * How long a member may hold a room, and how much of it (SPC-29).
 *
 * Charley: "admin can set the max duration of a room reservation. Make the
 * default 3 hours. The system max is 24 hours… allow for an admin to turn on
 * a setting for the maximum number of room reservations a member can make in
 * one year or one month."
 *
 * Two different limits, often confused. One keeps a room circulating; the
 * other is about a member's share of the building, which is a question about
 * fairness rather than scheduling and most co-ops never need to ask it.
 */

describe('how long one booking may run', () => {
  it('is three hours when nobody has said otherwise', () => {
    expect(DEFAULT_MAX_MINUTES).toBe(180);
    expect(effectiveMaxMinutes(null, null)).toBe(180);
  });

  it('is the co-op’s, where a room says nothing about itself', () => {
    expect(effectiveMaxMinutes(240, null)).toBe(240);
  });

  it('is the room’s, where that is shorter', () => {
    // A darkroom with a queue knows more about itself than the co-op does.
    expect(effectiveMaxMinutes(240, 60)).toBe(60);
  });

  it('is the co-op’s, where that is shorter', () => {
    // A co-op shortening its limit must not quietly lengthen a room's.
    expect(effectiveMaxMinutes(60, 240)).toBe(60);
  });

  it('never exceeds a day, whatever a co-op asks for', () => {
    // Longer than that is somebody moving in, not booking.
    expect(SYSTEM_MAX_MINUTES).toBe(1440);
    expect(effectiveMaxMinutes(99_999, null)).toBe(1440);
  });
});

describe('how a limit reads', () => {
  it('counts whole hours as hours', () => {
    expect(describeMinutes(180)).toBe('3 hours');
    expect(describeMinutes(60)).toBe('1 hour');
  });

  it('counts anything else in minutes', () => {
    expect(describeMinutes(90)).toBe('90 minutes');
  });
});

describe('the window a quota is counted over', () => {
  const at = new Date('2026-10-03T14:00:00Z');

  it('is a calendar month', () => {
    // A rolling thirty days means a member's allowance creeps forward and
    // nobody can say when it resets.
    const { from, to } = quotaWindow('MONTH', at);

    expect(from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('is a calendar year', () => {
    const { from, to } = quotaWindow('YEAR', at);

    expect(from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('rolls over at the end of December', () => {
    const { to } = quotaWindow('MONTH', new Date('2026-12-20T00:00:00Z'));

    expect(to.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('whether a booking takes somebody past their share', () => {
  const quota = { period: 'MONTH' as const, hours: 10 };

  it('allows anything when the cap is off', () => {
    // Off is the default and the commonest answer.
    expect(quotaProblem({ period: null, hours: null }, 10_000, 600)).toBeNull();
    expect(quotaProblem({ period: 'MONTH', hours: null }, 10_000, 600)).toBeNull();
  });

  it('allows a booking that fits', () => {
    expect(quotaProblem(quota, 480, 120)).toBeNull();
  });

  it('allows one that lands exactly on the limit', () => {
    expect(quotaProblem(quota, 540, 60)).toBeNull();
  });

  it('refuses one that goes past, and says how much is left', () => {
    // "You have reached your limit" with no number is a dead end: somebody
    // needs to know whether to book two hours instead of four.
    expect(quotaProblem(quota, 480, 180)).toMatch(/2 hours left/);
  });

  it('says plainly when there is nothing left', () => {
    expect(quotaProblem(quota, 600, 60)).toMatch(/used all 10 hours/);
  });

  it('names the stretch it is counting', () => {
    expect(quotaProblem(quota, 600, 60)).toMatch(/this month/);
    expect(quotaProblem({ period: 'YEAR', hours: 10 }, 600, 60)).toMatch(/this year/);
  });

  it('points somewhere, rather than just refusing', () => {
    expect(quotaProblem(quota, 600, 60)).toMatch(/Ask an organiser/);
  });
});
