import {
  DISMISSALS_UNTIL_SILENT,
  INTERESTS_PER_ASK,
  afterAnswer,
  afterDismissal,
  canAskInterests,
  nextAskAllowedAt,
  windowDaysFor,
} from '../interest-ask';

/**
 * How often MaybeOS asks a member what they are interested in (RDR-01).
 *
 * The thing being protected is the member's patience. A question that comes
 * back too often is how a co-op's software starts getting ignored, and the
 * failure is silent: nobody files a bug saying they stopped reading.
 */

const NOW = new Date('2026-10-01T12:00:00Z');
const daysAfter = (from: Date, days: number) =>
  new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

describe('the asking cadence', () => {
  it('asks a member who has never been asked', () => {
    expect(canAskInterests({ interestsAskedAt: null, interestsDismissals: 0 }, NOW)).toBe(true);
  });

  it('waits three weeks after an ask', () => {
    const state = { interestsAskedAt: NOW, interestsDismissals: 0 };

    expect(canAskInterests(state, daysAfter(NOW, 20))).toBe(false);
    expect(canAskInterests(state, daysAfter(NOW, 21))).toBe(true);
  });

  it('widens the gap each time it is waved away', () => {
    expect(windowDaysFor(0)).toBe(21);
    expect(windowDaysFor(1)).toBe(45);
    expect(windowDaysFor(2)).toBe(90);
  });

  it('stops asking after three dismissals, with no annual fallback', () => {
    const silent = { interestsAskedAt: NOW, interestsDismissals: DISMISSALS_UNTIL_SILENT };

    expect(windowDaysFor(DISMISSALS_UNTIL_SILENT)).toBeNull();
    expect(nextAskAllowedAt(silent)).toBeNull();
    // Not even in ten years. Three noes is an answer.
    expect(canAskInterests(silent, daysAfter(NOW, 3650))).toBe(false);
  });

  it('forgives the dismissals once a member actually answers', () => {
    const state = afterAnswer(NOW);

    expect(state.interestsDismissals).toBe(0);
    expect(state.interestsAskedAt).toBe(NOW);
  });

  it('counts a dismissal and restarts the clock', () => {
    const state = afterDismissal({ interestsAskedAt: null, interestsDismissals: 1 }, NOW);

    expect(state).toEqual({ interestsAskedAt: NOW, interestsDismissals: 2 });
  });

  it('offers the three or four Charley asked for, not a form', () => {
    expect(INTERESTS_PER_ASK).toBeLessThanOrEqual(4);
  });
});
