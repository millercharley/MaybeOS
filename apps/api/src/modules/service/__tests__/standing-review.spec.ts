import {
  STANDING_DUTY_REVIEW_MONTHS,
  lastLookedAt,
  needsReview,
  reviewDueAt,
} from '../standing-review';

/**
 * A standing duty nobody has looked at says so (SRV-04).
 *
 * Charley set the threshold at six months. The failure mode of a standing
 * arrangement is not somebody dropping it — that is visible the week it
 * happens — but the arrangement quietly ceasing to suit the person holding it
 * while nobody asks.
 */
describe('when a standing duty is due a look', () => {
  const NOW = new Date('2026-09-09T12:00:00Z');
  const at = (iso: string) => new Date(iso);

  it('is six months', () => {
    expect(STANDING_DUTY_REVIEW_MONTHS).toBe(6);
  });

  it('counts from adoption when nobody has ever reviewed it', () => {
    const adoption = { startedAt: at('2026-01-01T00:00:00Z'), reviewedAt: null };
    expect(lastLookedAt(adoption)).toEqual(at('2026-01-01T00:00:00Z'));
    expect(needsReview(adoption, NOW)).toBe(true);
  });

  it('counts from the last review once there has been one', () => {
    // The point of storing it: reviewing clears the flag rather than leaving
    // a badge that can never come off.
    const adoption = { startedAt: at('2025-01-01T00:00:00Z'), reviewedAt: at('2026-08-01T00:00:00Z') };
    expect(needsReview(adoption, NOW)).toBe(false);
  });

  it('comes back six months after that review', () => {
    const adoption = { startedAt: at('2025-01-01T00:00:00Z'), reviewedAt: at('2026-03-08T00:00:00Z') };
    expect(needsReview(adoption, NOW)).toBe(true);
  });

  it('leaves a duty adopted last week alone', () => {
    expect(needsReview({ startedAt: at('2026-09-02T00:00:00Z'), reviewedAt: null }, NOW)).toBe(false);
  });

  it('is due exactly on the six-month mark, not a day later', () => {
    // The boundary, asserted rather than assumed — six months is not something
    // a test can wait for.
    const adoption = { startedAt: at('2026-03-09T12:00:00Z'), reviewedAt: null };
    expect(reviewDueAt(adoption)).toEqual(at('2026-09-09T12:00:00Z'));
    expect(needsReview(adoption, NOW)).toBe(true);
    expect(needsReview(adoption, at('2026-09-09T11:59:59Z'))).toBe(false);
  });

  it('handles a month that has no matching day', () => {
    // 31 August + 6 months is 28 or 29 February, not 31 February. JavaScript
    // rolls it into March, which is the behaviour to be aware of rather than
    // surprised by.
    const due = reviewDueAt({ startedAt: at('2025-08-31T00:00:00Z'), reviewedAt: null });
    expect(due.getUTCMonth()).toBe(2); // March
  });
});
