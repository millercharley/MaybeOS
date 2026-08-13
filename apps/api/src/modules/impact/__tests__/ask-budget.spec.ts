import {
  canAsk,
  nextAskAllowedAt,
  windowDaysFor,
  afterAnswer,
  afterDismissal,
  asksPerYear,
  DISMISSALS_UNTIL_ANNUAL,
} from '../ask-budget';

/**
 * The fatigue budget (D-021, PRD §6.2).
 *
 * D-021 names this the load-bearing constraint of ImpactOS — above the AI,
 * above the schema — because response rate is what decides whether there is a
 * report in month twelve. Everything else in the module displays a number;
 * this decides whether a member is bothered at all, so it gets pinned hard.
 */
describe('the fatigue budget', () => {
  const NOW = new Date('2026-08-13T12:00:00Z');
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

  describe('one question per member per 30 days', () => {
    it('asks a member who has never been asked', () => {
      expect(canAsk({ lastAskedAt: null, askDismissals: 0 }, NOW)).toBe(true);
    });

    it('does not ask again the next day', () => {
      expect(canAsk({ lastAskedAt: daysAgo(1), askDismissals: 0 }, NOW)).toBe(false);
    });

    it('does not ask again at 29 days', () => {
      expect(canAsk({ lastAskedAt: daysAgo(29), askDismissals: 0 }, NOW)).toBe(false);
    });

    it('asks again at 30 days', () => {
      expect(canAsk({ lastAskedAt: daysAgo(30), askDismissals: 0 }, NOW)).toBe(true);
    });

    it('spends one budget across every touchpoint', () => {
      // The whole point of "across all touchpoints": a member who answered at
      // a ticket purchase must not then be asked at a booking the same week.
      // Nothing here is per-touchpoint, and that is the design.
      const justAsked = { lastAskedAt: daysAgo(2), askDismissals: 0 };

      expect(canAsk(justAsked, NOW)).toBe(false);
    });
  });

  describe('dismissal widens the window', () => {
    it('moves a member to 60 days after one dismissal', () => {
      // Declining is information. Asking again on the same cadence answers
      // "no" by repeating the question.
      expect(windowDaysFor(1)).toBe(60);
      expect(canAsk({ lastAskedAt: daysAgo(45), askDismissals: 1 }, NOW)).toBe(false);
      expect(canAsk({ lastAskedAt: daysAgo(60), askDismissals: 1 }, NOW)).toBe(true);
    });

    it('moves a member to 90 days after two', () => {
      expect(windowDaysFor(2)).toBe(90);
      expect(canAsk({ lastAskedAt: daysAgo(89), askDismissals: 2 }, NOW)).toBe(false);
    });

    it('counts a dismissal and restarts the clock', () => {
      const after = afterDismissal({ lastAskedAt: daysAgo(40), askDismissals: 0 }, NOW);

      expect(after.askDismissals).toBe(1);
      expect(after.lastAskedAt).toEqual(NOW);
    });
  });

  describe('three dismissals means annual only', () => {
    it('drops to a yearly window at the third dismissal', () => {
      expect(windowDaysFor(DISMISSALS_UNTIL_ANNUAL)).toBe(365);
      expect(canAsk({ lastAskedAt: daysAgo(200), askDismissals: 3 }, NOW)).toBe(false);
      expect(canAsk({ lastAskedAt: daysAgo(365), askDismissals: 3 }, NOW)).toBe(true);
    });

    it('stays annual however many more times they decline', () => {
      expect(windowDaysFor(9)).toBe(365);
    });

    it('offers no way to override it', () => {
      // D-021: "three dismissals moving them to annual-check-in-only with no
      // admin override". A `force` argument here is exactly how that becomes
      // one, so canAsk takes only state and a clock.
      expect(canAsk.length).toBeLessThanOrEqual(2);
    });
  });

  describe('answering', () => {
    it('restarts the clock', () => {
      const after = afterAnswer({ lastAskedAt: daysAgo(40), askDismissals: 0 }, NOW);

      expect(after.lastAskedAt).toEqual(NOW);
    });

    it('does not forgive earlier dismissals', () => {
      // Somebody who declined twice and then answers is still somebody who
      // declined twice; clearing the count would walk them back to a cadence
      // they had already pushed away from.
      const after = afterAnswer({ lastAskedAt: daysAgo(90), askDismissals: 2 }, NOW);

      expect(after.askDismissals).toBe(2);
    });
  });

  it('adds up to roughly the twelve a year the PRD claims', () => {
    expect(asksPerYear(0)).toBe(12);
    expect(asksPerYear(1)).toBe(6);
    expect(asksPerYear(2)).toBe(4);
    expect(asksPerYear(3)).toBe(1);
  });

  it('reports when a member next becomes askable', () => {
    const at = nextAskAllowedAt({ lastAskedAt: new Date('2026-08-01T00:00:00Z'), askDismissals: 0 });

    expect(at).toEqual(new Date('2026-08-31T00:00:00Z'));
  });
});
