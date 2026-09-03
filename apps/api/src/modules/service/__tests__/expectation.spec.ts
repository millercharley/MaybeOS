import { currentWindow, expectedMinutes, standingFor } from '../expectation';

/**
 * What a tier asks, and over what stretch of time (SRV-01).
 *
 * The case worth writing down is the new member. Without proration, somebody
 * who joins on 20 December is 24 hours behind a yearly expectation on the day
 * they sign up, and the first thing the co-op's own software tells them is
 * that they are already failing.
 */
const NY = 'America/New_York';
const at = (iso: string) => new Date(iso);

describe('currentWindow', () => {
  it('runs a week Sunday to Saturday', () => {
    // Matching `0 = Sunday` from the room opening hours. Wed 15 Jul 2026.
    expect(currentWindow('WEEK', at('2026-07-15T16:00:00Z'), NY)).toEqual({
      from: '2026-07-12',
      to: '2026-07-18',
    });
  });

  it('runs a month to its real last day', () => {
    expect(currentWindow('MONTH', at('2026-02-10T16:00:00Z'), NY)).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('runs a year January to December', () => {
    expect(currentWindow('YEAR', at('2026-07-15T16:00:00Z'), NY)).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
  });

  it('reads the window in the co-op\'s timezone, not the server\'s', () => {
    // 1 Feb 04:00 UTC is still 31 January in New York, so this is January's
    // window. A server in UTC would put the member in the wrong month.
    expect(currentWindow('MONTH', at('2026-02-01T04:00:00Z'), NY).from).toBe('2026-01-01');
  });
});

describe('expectedMinutes', () => {
  const window = { from: '2026-01-01', to: '2026-12-31' };

  it('asks nothing when the tier asks nothing', () => {
    expect(
      expectedMinutes({
        tierMinutes: null,
        window,
        memberSince: at('2020-01-01T00:00:00Z'),
        timeZone: NY,
      }),
    ).toBeNull();
  });

  it('asks the full amount of a member who was already here', () => {
    expect(
      expectedMinutes({
        tierMinutes: 1440,
        window,
        memberSince: at('2020-01-01T00:00:00Z'),
        timeZone: NY,
      }),
    ).toBe(1440);
  });

  it('prorates a member who joined part way through', () => {
    // Joined 1 July: half the year left, so half the expectation.
    const half = expectedMinutes({
      tierMinutes: 1440,
      window,
      memberSince: at('2026-07-01T16:00:00Z'),
      timeZone: NY,
    });
    expect(half).toBe(Math.round(1440 * (184 / 365)));
    expect(half).toBeLessThan(1440);
  });

  it('asks almost nothing of somebody who joined yesterday', () => {
    const late = expectedMinutes({
      tierMinutes: 1440,
      window,
      memberSince: at('2026-12-30T16:00:00Z'),
      timeZone: NY,
    });
    // Two days of a year, not a year.
    expect(late).toBe(Math.round(1440 * (2 / 365)));
  });

  it('asks nothing of a membership that has not started', () => {
    expect(
      expectedMinutes({
        tierMinutes: 1440,
        window,
        memberSince: at('2027-03-01T16:00:00Z'),
        timeZone: NY,
      }),
    ).toBe(0);
  });
});

describe('standingFor', () => {
  const base = {
    period: 'MONTH' as const,
    tierMinutes: 240,
    memberSince: at('2020-01-01T00:00:00Z'),
    timeZone: NY,
    now: at('2026-07-15T16:00:00Z'),
  };

  it('reports what is still owed', () => {
    const standing = standingFor({ ...base, servedMinutes: 90 });
    expect(standing.expectedMinutes).toBe(240);
    expect(standing.shortfallMinutes).toBe(150);
    expect(standing.prorated).toBe(false);
  });

  it('floors the shortfall at zero rather than going negative', () => {
    // Somebody who did more than asked is not owed a refund of hours.
    const standing = standingFor({ ...base, servedMinutes: 600 });
    expect(standing.shortfallMinutes).toBe(0);
  });

  it('says nothing is owed when the tier asks nothing', () => {
    const standing = standingFor({ ...base, tierMinutes: null, servedMinutes: 0 });
    expect(standing.expectedMinutes).toBeNull();
    expect(standing.shortfallMinutes).toBeNull();
  });

  it('flags a prorated window, so the number can be explained', () => {
    const standing = standingFor({
      ...base,
      memberSince: at('2026-07-10T16:00:00Z'),
      servedMinutes: 0,
    });
    expect(standing.prorated).toBe(true);
    expect(standing.expectedMinutes).toBeLessThan(240);
  });
});
