import {
  BuddyCandidate,
  RotationPolicy,
  selectCandidate,
} from '../buddy-rotation';

/**
 * Fairness, tested as a property rather than as an example (PRD §8.4).
 *
 * "Across 20 sequential new members in a community of 10 eligible members, no
 * member is asked a second time until every eligible member has been asked
 * once" is the whole point of the Buddy System. A rotation that quietly
 * favours the same three willing people is worse than no rotation, because
 * the co-op believes it has one.
 */
describe('buddy rotation', () => {
  const policy: RotationPolicy = {
    maxActivePairings: 1,
    askCooldownDays: 30,
    serveCooldownDays: 90,
  };

  const member = (id: string, over: Partial<BuddyCandidate> = {}): BuddyCandidate => ({
    memberId: id,
    timesServed: 0,
    timesAsked: 0,
    lastAskedAt: null,
    lastServedAt: null,
    optedOut: false,
    activePairings: 0,
    hasOutstandingInvitation: false,
    ...over,
  });

  // Deterministic tiebreak, so a failure is a failure rather than a mood.
  const noTiebreak = () => 0.5;
  const NOW = new Date('2026-08-28T12:00:00Z');
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

  describe('the promise: everyone before anyone twice', () => {
    it('asks all ten before asking anyone a second time, over twenty new members', () => {
      // Everyone declines, so nobody ever serves and the only thing
      // distinguishing people is when they were last asked. This is the
      // hardest version of the promise: the tiebreak is doing no work.
      const pool = Array.from({ length: 10 }, (_, i) => member(`m${i}`));
      const asked: string[] = [];
      let clock = NOW.getTime();

      for (let i = 0; i < 20; i++) {
        const { candidate } = selectCandidate(pool, policy, new Date(clock), noTiebreak);
        expect(candidate).not.toBeNull();

        asked.push(candidate!.memberId);
        // A decline records the ask and moves on — §5.2's "every ask writes
        // to the log whether or not it is answered".
        candidate!.timesAsked += 1;
        candidate!.lastAskedAt = new Date(clock);
        clock += 60 * 60 * 1000; // an hour between new members
      }

      const firstTen = asked.slice(0, 10);
      expect(new Set(firstTen).size).toBe(10);

      // And the second pass is a pass, not a scramble: the second ten are
      // also all distinct.
      expect(new Set(asked.slice(10, 20)).size).toBe(10);
    });

    it('holds when some members have served before', () => {
      // Two people have already hosted. They must go last, both rounds,
      // because served-count outranks last-asked.
      const pool = [
        member('veteran-a', { timesServed: 2, lastServedAt: daysAgo(200) }),
        member('veteran-b', { timesServed: 1, lastServedAt: daysAgo(200) }),
        ...Array.from({ length: 4 }, (_, i) => member(`fresh${i}`)),
      ];
      const asked: string[] = [];
      let clock = NOW.getTime();

      for (let i = 0; i < 6; i++) {
        const { candidate } = selectCandidate(pool, policy, new Date(clock), noTiebreak);
        asked.push(candidate!.memberId);
        candidate!.timesAsked += 1;
        candidate!.lastAskedAt = new Date(clock);
        clock += 60 * 60 * 1000;
      }

      expect(asked.slice(0, 4).sort()).toEqual(['fresh0', 'fresh1', 'fresh2', 'fresh3']);
      expect(asked.slice(4)).toEqual(['veteran-b', 'veteran-a']);
    });
  });

  describe('who cannot be asked at all', () => {
    it('never asks someone who opted out', () => {
      const { candidate } = selectCandidate(
        [member('opted', { optedOut: true }), member('willing')],
        policy,
        NOW,
        noTiebreak,
      );
      expect(candidate!.memberId).toBe('willing');
    });

    it('never asks someone who already has an unanswered invitation', () => {
      // Two invitations in one inbox for two different new members is how a
      // willing member starts ignoring them.
      const { candidate } = selectCandidate(
        [member('busy', { hasOutstandingInvitation: true }), member('free')],
        policy,
        NOW,
        noTiebreak,
      );
      expect(candidate!.memberId).toBe('free');
    });

    it('never asks someone already at their pairing limit', () => {
      const { candidate } = selectCandidate(
        [member('full', { activePairings: 1 }), member('spare')],
        policy,
        NOW,
        noTiebreak,
      );
      expect(candidate!.memberId).toBe('spare');
    });

    it('respects a limit above one', () => {
      const { candidate } = selectCandidate(
        [member('two-pairs', { activePairings: 2 }), member('one-pair', { activePairings: 1 })],
        { ...policy, maxActivePairings: 2 },
        NOW,
        noTiebreak,
      );
      expect(candidate!.memberId).toBe('one-pair');
    });

    it('returns nobody when everyone is excluded', () => {
      // This is what sends a pairing to needs_admin — not an error.
      const { candidate } = selectCandidate(
        [member('a', { optedOut: true }), member('b', { activePairings: 1 })],
        policy,
        NOW,
        noTiebreak,
      );
      expect(candidate).toBeNull();
    });
  });

  describe('cooldowns are soft', () => {
    it('skips someone asked inside the ask cooldown', () => {
      const { candidate, relaxedCooldowns } = selectCandidate(
        [member('recent', { lastAskedAt: daysAgo(5) }), member('rested', { lastAskedAt: daysAgo(60) })],
        policy,
        NOW,
        noTiebreak,
      );
      expect(candidate!.memberId).toBe('rested');
      expect(relaxedCooldowns).toBe(false);
    });

    it('skips someone who served inside the serve cooldown', () => {
      const { candidate } = selectCandidate(
        [
          member('just-served', { timesServed: 1, lastServedAt: daysAgo(10) }),
          member('served-long-ago', { timesServed: 1, lastServedAt: daysAgo(200) }),
        ],
        policy,
        NOW,
        noTiebreak,
      );
      expect(candidate!.memberId).toBe('served-long-ago');
    });

    it('sets cooldowns aside rather than giving up', () => {
      // A co-op of six cannot honour a thirty-day cooldown and still welcome
      // someone every fortnight. Asking slightly sooner than ideal beats
      // handing every new member to an admin.
      const { candidate, relaxedCooldowns } = selectCandidate(
        [member('a', { lastAskedAt: daysAgo(2) }), member('b', { lastAskedAt: daysAgo(1) })],
        policy,
        NOW,
        noTiebreak,
      );
      expect(candidate!.memberId).toBe('a');
      expect(relaxedCooldowns).toBe(true);
    });

    it('does not relax a hard exclusion when it relaxes cooldowns', () => {
      // Opting out is a decision, not a cooldown. A small co-op running hot
      // must still never ask someone who said no.
      const { candidate } = selectCandidate(
        [member('opted', { optedOut: true }), member('tired', { lastAskedAt: daysAgo(1) })],
        policy,
        NOW,
        noTiebreak,
      );
      expect(candidate!.memberId).toBe('tired');
    });

    it('reports the relaxation so a co-op can see it is running hot', () => {
      const { relaxedCooldowns } = selectCandidate(
        [member('only', { lastAskedAt: daysAgo(1) })],
        policy,
        NOW,
        noTiebreak,
      );
      expect(relaxedCooldowns).toBe(true);
    });
  });

  describe('ordering details', () => {
    it('prefers never-asked over asked-long-ago', () => {
      const { candidate } = selectCandidate(
        [member('asked', { lastAskedAt: daysAgo(365) }), member('never')],
        policy,
        NOW,
        noTiebreak,
      );
      expect(candidate!.memberId).toBe('never');
    });

    it('breaks a true tie by chance, not by position', () => {
      // Two identical candidates. Over many draws both should appear —
      // otherwise the "random tiebreak" is whichever the database returned
      // first, which is the join order and therefore the oldest member.
      const seen = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const { candidate } = selectCandidate([member('a'), member('b')], policy, NOW);
        seen.add(candidate!.memberId);
      }
      expect(seen.size).toBe(2);
    });

    it('does not mutate the pool it was given', () => {
      const pool = [member('b', { timesServed: 1 }), member('a')];
      const before = pool.map((c) => c.memberId);
      selectCandidate(pool, policy, NOW, noTiebreak);
      expect(pool.map((c) => c.memberId)).toEqual(before);
    });
  });
});
