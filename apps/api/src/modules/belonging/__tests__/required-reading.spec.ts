import {
  RequiredArticle,
  graceEndsAt,
  outstandingReading,
  readingStatus,
} from '../required-reading';

/**
 * The grace period, which is where this is easy to get wrong in both
 * directions (PRD §6.2).
 *
 * Gate somebody too early and a member who has done nothing wrong cannot
 * post. Gate too late and a co-op believes everyone has agreed to something
 * they have not read. Both failures are silent.
 */
describe('required reading', () => {
  const NOW = new Date('2026-08-28T12:00:00Z');
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
  const GRACE = 14;

  const article = (over: Partial<RequiredArticle> = {}): RequiredArticle => ({
    id: 'a1',
    title: 'House rules',
    slug: 'house-rules',
    version: 1,
    requiredSince: daysAgo(30),
    ...over,
  });

  const reader = (memberSince: Date, acked: Record<string, number> = {}) => ({
    memberSince,
    acknowledgedVersions: new Map(Object.entries(acked)),
  });

  describe('the rule: grace from whichever came later', () => {
    it('gives a member who joined after the rules were published their own window', () => {
      /*
        This used to block them outright, on the reasoning that the rules are
        part of what they joined (BEL-07). It reads well and worked badly: a
        new member's first act is usually the one they joined to do — booking
        the room — and meeting a refusal there is a poor way to begin.

        Charley: "make this really easy for them by just reminding them to
        review these documents within 30 days instead of forcing them out of
        creating the event or booking their room."
      */
      const state = readingStatus(article(), reader(daysAgo(2)), GRACE, NOW);

      expect(state.status).toBe('in-grace');
      // Counted from the day they joined, not from the older requirement —
      // otherwise their window would have closed before they arrived.
      if (state.status === 'in-grace') {
        expect(state.until).toEqual(new Date(daysAgo(2).getTime() + GRACE * 24 * 60 * 60 * 1000));
      }
    });

    it('blocks them once that window has passed', () => {
      // The handbook still has to be read. It does not have to be read in the
      // ninety seconds before somebody can do the thing they came for.
      const state = readingStatus(article(), reader(daysAgo(GRACE + 1)), GRACE, NOW);
      expect(state.status).toBe('blocking');
    });

    it('gives grace to a member who was already here', () => {
      const state = readingStatus(
        article({ requiredSince: daysAgo(3) }),
        reader(daysAgo(700)),
        GRACE,
        NOW,
      );
      expect(state).toEqual({
        status: 'in-grace',
        until: new Date(daysAgo(3).getTime() + GRACE * 86400000),
      });
    });

    it('blocks that same member once the grace runs out', () => {
      const state = readingStatus(
        article({ requiredSince: daysAgo(20) }),
        reader(daysAgo(700)),
        GRACE,
        NOW,
      );
      expect(state.status).toBe('blocking');
    });

    it('blocks at the exact moment grace expires, not a day later', () => {
      const requiredSince = new Date(NOW.getTime() - GRACE * 86400000);
      expect(readingStatus(article({ requiredSince }), reader(daysAgo(700)), GRACE, NOW).status).toBe(
        'blocking',
      );
    });

    it('still grants grace one second before it expires', () => {
      const requiredSince = new Date(NOW.getTime() - GRACE * 86400000 + 1000);
      expect(readingStatus(article({ requiredSince }), reader(daysAgo(700)), GRACE, NOW).status).toBe(
        'in-grace',
      );
    });
  });

  describe('agreement', () => {
    it('clears the article once agreed', () => {
      expect(readingStatus(article(), reader(daysAgo(2), { a1: 1 }), GRACE, NOW).status).toBe('done');
    });

    it('does not clear it when a material edit bumped the version', () => {
      /*
        Agreeing to v1 says nothing about v2. This is the whole reason
        acknowledgments record a version.

        Asserted as "not done" rather than "blocking" since BEL-07: a member
        who joined two days ago is inside their own window, so v2 is owed and
        not yet blocking. What matters here is that agreeing to v1 did not
        settle it.
      */
      const state = readingStatus(article({ version: 2 }), reader(daysAgo(2), { a1: 1 }), GRACE, NOW);
      expect(state.status).not.toBe('done');

      // And it does block, once their window has run out.
      const later = readingStatus(
        article({ version: 2 }),
        reader(daysAgo(GRACE + 1), { a1: 1 }),
        GRACE,
        NOW,
      );
      expect(later.status).toBe('blocking');
    });

    it('gives a long-standing member fresh grace on a new version', () => {
      // v2 gets its own window rather than inheriting one that closed a year
      // ago — otherwise a material change would lock the co-op out instantly.
      const state = readingStatus(
        article({ version: 2, requiredSince: daysAgo(1) }),
        reader(daysAgo(700), { a1: 1 }),
        GRACE,
        NOW,
      );
      expect(state.status).toBe('in-grace');
    });
  });

  describe('an article that requires nothing blocks nobody', () => {
    it('treats a null requiredSince as not-yet-required, never as forever', () => {
      // Defaulting a null to "required since the beginning of time" would
      // lock an entire co-op out on the strength of a missing column.
      expect(readingStatus(article({ requiredSince: null }), reader(daysAgo(2)), GRACE, NOW).status).toBe(
        'done',
      );
    });
  });

  describe('across a co-op’s whole set', () => {
    const rules = article({ id: 'rules', requiredSince: daysAgo(400) });
    const newPolicy = article({ id: 'policy', requiredSince: daysAgo(2) });

    it('separates what blocks from what is merely owed', () => {
      const result = outstandingReading([rules, newPolicy], reader(daysAgo(300)), GRACE, NOW);

      // Joined 300 days ago: after the rules (blocking), before the policy
      // (still in grace).
      expect(result.blocking.map((a) => a.id)).toEqual(['rules']);
      expect(result.inGrace.map((e) => e.article.id)).toEqual(['policy']);
    });

    it('keeps the admin’s order, so onboarding reads in the intended sequence', () => {
      const first = article({ id: 'first', requiredSince: daysAgo(400) });
      const second = article({ id: 'second', requiredSince: daysAgo(400) });
      // A member long past their window, so both are blocking and the order
      // is the thing under test. It used to read `daysAgo(2)`, which blocked
      // only because joining after the requirement did; since BEL-07 that
      // member is inside their own window and nothing blocks at all.
      const result = outstandingReading([first, second], reader(daysAgo(400)), GRACE, NOW);
      expect(result.blocking.map((a) => a.id)).toEqual(['first', 'second']);
    });

    it('counts down to the nearest deadline, not the furthest', () => {
      // A banner counting down to the last article would let somebody be
      // blocked by the first one while it still said they had a week.
      const soon = article({ id: 'soon', requiredSince: daysAgo(13) });
      const later = article({ id: 'later', requiredSince: daysAgo(1) });
      const result = outstandingReading([later, soon], reader(daysAgo(700)), GRACE, NOW);

      expect(graceEndsAt(result)).toEqual(new Date(daysAgo(13).getTime() + GRACE * 86400000));
    });

    it('has no countdown when nothing is owed', () => {
      const result = outstandingReading([rules], reader(daysAgo(300), { rules: 1 }), GRACE, NOW);
      expect(graceEndsAt(result)).toBeNull();
      expect(result.blocking).toEqual([]);
    });

    it('respects a co-op that set its grace to zero', () => {
      // Zero days means the requirement bites immediately for everyone, which
      // is a legitimate choice for a safeguarding policy.
      const result = outstandingReading([newPolicy], reader(daysAgo(700)), 0, NOW);
      expect(result.blocking.map((a) => a.id)).toEqual(['policy']);
      expect(result.inGrace).toEqual([]);
    });
  });
});
