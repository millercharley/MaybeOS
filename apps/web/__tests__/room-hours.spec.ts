import {
  emptyWeek,
  problemWith,
  rulesFromWeek,
  summarise,
  weekFromRules,
  type Week,
} from '@/lib/room-hours';
import type { AvailabilityRule } from '@/lib/api';

/**
 * Opening hours, as a week to edit and rules to store (SPC-17).
 *
 * The rules API has existed since SpaceOS was built and nothing had ever
 * called it, so a room could only ever be marked always-available or left
 * unbookable — which is what the Attic was.
 */
const rule = (over: Partial<AvailabilityRule>): AvailabilityRule =>
  ({
    id: 'r1',
    dayOfWeek: null,
    startTime: '09:00',
    endTime: '17:00',
    isBlackout: false,
    ...over,
  }) as AvailabilityRule;

describe('weekFromRules', () => {
  it('spreads an all-days rule across the week', () => {
    const week = weekFromRules([rule({ dayOfWeek: null })]);

    expect(week.every((d) => d.open && d.from === '09:00' && d.to === '17:00')).toBe(true);
  });

  it('opens only the days a per-day rule names', () => {
    const week = weekFromRules([
      rule({ id: 'a', dayOfWeek: 2, startTime: '10:00', endTime: '18:00' }),
      rule({ id: 'b', dayOfWeek: 3, startTime: '10:00', endTime: '18:00' }),
    ]);

    expect(week.map((d) => d.open)).toEqual([false, false, true, true, false, false, false]);
    expect(week[2]).toMatchObject({ from: '10:00', to: '18:00' });
  });

  it('lets a specific day sit alongside an all-days rule', () => {
    // Dropping the all-days rule, or letting it overwrite the specific one,
    // both lose hours the co-op actually published.
    const week = weekFromRules([
      rule({ id: 'a', dayOfWeek: null, startTime: '09:00', endTime: '17:00' }),
      rule({ id: 'b', dayOfWeek: 6, startTime: '08:00', endTime: '20:00' }),
    ]);

    expect(week[1]).toMatchObject({ open: true, from: '09:00', to: '17:00' });
    expect(week[6]).toMatchObject({ open: true, from: '08:00', to: '20:00' });
  });

  it('keeps the widest span when a day has two windows', () => {
    // Two windows on one day is representable in the API and not in this
    // editor. Narrowing on load would silently shorten the day on save.
    const week = weekFromRules([
      rule({ id: 'a', dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }),
      rule({ id: 'b', dayOfWeek: 1, startTime: '14:00', endTime: '18:00' }),
    ]);

    expect(week[1]).toMatchObject({ from: '09:00', to: '18:00' });
  });

  it('ignores blackouts', () => {
    // A blackout subtracts from opening hours rather than describing them.
    const week = weekFromRules([
      rule({ id: 'a', dayOfWeek: 1, startTime: '12:00', endTime: '13:00', isBlackout: true }),
    ]);

    expect(week.some((d) => d.open)).toBe(false);
  });

  it('gives a closed week when there are no rules', () => {
    expect(weekFromRules([]).some((d) => d.open)).toBe(false);
    expect(weekFromRules().some((d) => d.open)).toBe(false);
  });
});

describe('rulesFromWeek', () => {
  const week = (days: number[], from = '09:00', to = '17:00'): Week => {
    const w = emptyWeek();
    for (const d of days) w[d] = { open: true, from, to };
    return w;
  };

  it('collapses a uniform week into one all-days rule', () => {
    expect(rulesFromWeek(week([0, 1, 2, 3, 4, 5, 6]))).toEqual([
      { dayOfWeek: null, startTime: '09:00', endTime: '17:00' },
    ]);
  });

  it('writes a rule per day when the days differ', () => {
    const w = week([1, 2]);
    w[2] = { open: true, from: '10:00', to: '20:00' };

    expect(rulesFromWeek(w)).toEqual([
      { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
      { dayOfWeek: 2, startTime: '10:00', endTime: '20:00' },
    ]);
  });

  it('does not collapse a partly open week even with matching hours', () => {
    // Same hours on five days is still five rules: an all-days rule would open
    // the other two.
    expect(rulesFromWeek(week([1, 2, 3, 4, 5]))).toHaveLength(5);
  });

  it('writes nothing for a closed week', () => {
    expect(rulesFromWeek(emptyWeek())).toEqual([]);
  });

  it('round-trips a week through rules and back', () => {
    const original = week([2, 3, 4, 5, 6], '10:00', '18:00');

    expect(weekFromRules(rulesFromWeek(original).map((r, i) => rule({ id: `r${i}`, ...r })))).toEqual(
      original,
    );
  });
});

describe('problemWith', () => {
  const oneDay = (from: string, to: string): Week => {
    const w = emptyWeek();
    w[1] = { open: true, from, to };
    return w;
  };

  it('accepts an ordinary day', () => {
    expect(problemWith(oneDay('09:00', '17:00'))).toBeNull();
  });

  it('catches a day that closes before it opens', () => {
    // This stores happily and then silently offers no slots, which reads as
    // the feature being broken rather than the hours being wrong.
    expect(problemWith(oneDay('18:00', '09:00'))).toContain('Monday');
  });

  it('catches a day that closes exactly when it opens', () => {
    expect(problemWith(oneDay('09:00', '09:00'))).not.toBeNull();
  });

  it('catches a missing time', () => {
    expect(problemWith(oneDay('09:00', ''))).toContain('Monday');
  });

  it('ignores closed days entirely', () => {
    const w = emptyWeek();
    w[1] = { open: false, from: '18:00', to: '09:00' };

    expect(problemWith(w)).toBeNull();
  });
});

describe('summarise', () => {
  it('says when nothing is set', () => {
    expect(summarise(emptyWeek())).toBe('No bookable hours set.');
  });

  it('reads a uniform week as every day', () => {
    const w = emptyWeek().map(() => ({ open: true, from: '09:00', to: '17:00' }));

    expect(summarise(w)).toBe('Every day, 09:00–17:00');
  });

  it('names the open days', () => {
    const w = emptyWeek();
    w[2] = { open: true, from: '10:00', to: '18:00' };
    w[3] = { open: true, from: '10:00', to: '18:00' };

    expect(summarise(w)).toBe('Tue, Wed, 10:00–18:00');
  });

  it('does not claim one set of hours when they differ', () => {
    const w = emptyWeek();
    w[2] = { open: true, from: '10:00', to: '18:00' };
    w[3] = { open: true, from: '09:00', to: '12:00' };

    expect(summarise(w)).toContain('varying hours');
  });
});
