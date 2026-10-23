import {
  DECLARED_NO,
  DECLARED_YES,
  InterestStanding,
  MAX_INFERRED,
  interestWeights,
  rankMatches,
  scoreEvent,
} from '../radar-match';

/**
 * What Radar decides to tell a member about (RDR-01).
 *
 * The failure this guards against is not a crash. It is a co-op switching
 * Radar on and members getting email about the one thing they said they did
 * not want — which costs the feature its credibility in a single send, and
 * is invisible to every test that only checks the email went out.
 */

const at = (iso: string) => new Date(iso);

/**
 * `title` defaults to the id, so every fixture is its own gathering unless a
 * test deliberately makes two share a name. Defaulting it to a constant would
 * have quietly collapsed every one of these into a single run (RDR-05).
 */
const event = (
  id: string,
  tags: string[],
  when = '2026-10-08T18:00:00Z',
  title = id,
) => ({
  id,
  startTime: at(when),
  title,
  tags,
});

const said = (tagName: string, declared: boolean): InterestStanding => ({
  tagName,
  declared,
  rsvpCount: 0,
});

const inferred = (tagName: string, rsvpCount: number): InterestStanding => ({
  tagName,
  declared: null,
  rsvpCount,
});

describe('what an interest is worth', () => {
  it('counts a declared yes for more than any amount of inference', () => {
    const weights = interestWeights([said('Games', true), inferred('Music', 99)]);

    expect(weights.get('Games')).toBe(DECLARED_YES);
    expect(weights.get('Music')).toBe(MAX_INFERRED);
    expect(DECLARED_YES).toBeGreaterThan(MAX_INFERRED);
  });

  it('caps inference, so one enthusiasm cannot drown out everything else', () => {
    const weights = interestWeights([inferred('Music', 40)]);
    expect(weights.get('Music')).toBe(MAX_INFERRED);
  });

  it('treats a declared no as the opposite of a declared yes', () => {
    const weights = interestWeights([said('Care or support', false)]);
    expect(weights.get('Care or support')).toBe(DECLARED_NO);
    expect(DECLARED_NO).toBe(-DECLARED_YES);
  });

  it('ignores an interest nobody has answered or acted on', () => {
    const weights = interestWeights([inferred('Outdoors', 0)]);
    expect(weights.get('Outdoors')).toBe(0);
  });
});

describe('scoring one gathering', () => {
  it('reports only the interests that earned it, because the email says so', () => {
    const weights = interestWeights([said('Games', true), said('Learning', false)]);
    const scored = scoreEvent(event('e1', ['Games', 'Learning']), weights);

    // "Because you said you're interested in Games" has to be true, and
    // Learning is the opposite of a reason this member is being told.
    expect(scored.matched).toEqual(['Games']);
  });

  it('cancels a yes with a no, rather than letting either win outright', () => {
    const weights = interestWeights([said('Games', true), said('Care or support', false)]);
    const scored = scoreEvent(event('e1', ['Games', 'Care or support']), weights);

    expect(scored.score).toBe(0);
  });

  it('counts a tag once however many times the host typed it', () => {
    const weights = interestWeights([said('Games', true)]);
    expect(scoreEvent(event('e1', ['Games', 'Games', ' Games ']), weights).score).toBe(DECLARED_YES);
  });
});

describe('choosing what goes in a digest', () => {
  const standings = [said('Games', true), inferred('Music', 2), said('Care or support', false)];

  it('sends nothing to a member who has told MaybeOS nothing', () => {
    expect(rankMatches([event('e1', ['Games'])], [], 5)).toEqual([]);
  });

  it('leaves out a gathering carrying only an interest they waved away', () => {
    const picked = rankMatches([event('e1', ['Care or support'])], standings, 5);
    expect(picked).toEqual([]);
  });

  it('includes one matched on an RSVP alone — the brief was "loosely matches"', () => {
    const picked = rankMatches([event('e1', ['Music'])], standings, 5);
    expect(picked.map((p) => p.event.id)).toEqual(['e1']);
  });

  it('puts the strongest match first, and breaks a tie toward what is sooner', () => {
    const picked = rankMatches(
      [
        event('inferred-later', ['Music'], '2026-10-20T18:00:00Z'),
        event('declared-later', ['Games'], '2026-10-30T18:00:00Z'),
        event('declared-sooner', ['Games'], '2026-10-09T18:00:00Z'),
      ],
      standings,
      5,
    );

    expect(picked.map((p) => p.event.id)).toEqual([
      'declared-sooner',
      'declared-later',
      'inferred-later',
    ]);
  });

  it('keeps the digest to the cap, dropping the weakest matches', () => {
    const events = Array.from({ length: 9 }, (_, i) =>
      event(`e${i}`, i < 3 ? ['Games'] : ['Music'], `2026-10-${String(10 + i)}T18:00:00Z`),
    );

    const picked = rankMatches(events, standings, 5);

    expect(picked).toHaveLength(5);
    expect(picked.slice(0, 3).map((p) => p.event.id)).toEqual(['e0', 'e1', 'e2']);
  });

  it('sends nothing when the limit is nothing', () => {
    expect(rankMatches([event('e1', ['Games'])], standings, 0)).toEqual([]);
  });
});

/**
 * One performance on several nights, as one card (RDR-05).
 *
 * Charley, with the digest in front of him: "avoid posting the same
 * performance multiple times for a performance that has multiple dates."
 * *Dog Sees God* ran three nights and filled three of the five places in his
 * radar email, each with its own button.
 *
 * Nothing in the data says they are one thing — `parentEventId` is null and
 * `recurrence` is NONE on all three, because the host made them one after
 * another. The title is the only evidence there is.
 */
describe('a performance with several dates', () => {
  const standings = [said('Games', true), inferred('Music', 2)];

  const night = (id: string, when: string, title = 'Dog Sees God') =>
    event(id, ['Games'], when, title);

  const run = [
    night('oct-30', '2026-10-30T23:00:00Z'),
    night('oct-29', '2026-10-29T23:00:00Z'),
    night('oct-31', '2026-10-31T18:00:00Z'),
  ];

  it('is one entry, not three', () => {
    const picked = rankMatches(run, standings, 5);

    expect(picked).toHaveLength(1);
    expect(picked[0].event.title).toBe('Dog Sees God');
  });

  it('leads with the soonest night, whatever order they arrived in', () => {
    const picked = rankMatches(run, standings, 5);

    expect(picked[0].event.id).toBe('oct-29');
  });

  it('carries every night, soonest first', () => {
    const picked = rankMatches(run, standings, 5);

    expect(picked[0].events.map((e) => e.id)).toEqual(['oct-29', 'oct-30', 'oct-31']);
  });

  /**
   * The half of the fix that is easy to miss. Scoring, slicing, then grouping
   * would let one play take three of five places and then collapse into one
   * card — a digest that mentions two things and had room for four.
   */
  it('spends one of the digest\u2019s places, not three', () => {
    const others = [
      event('other-1', ['Games'], '2026-11-01T18:00:00Z'),
      event('other-2', ['Games'], '2026-11-02T18:00:00Z'),
    ];

    const picked = rankMatches([...run, ...others], standings, 3);

    expect(picked.map((p) => p.event.id)).toEqual(['oct-29', 'other-1', 'other-2']);
  });

  it('matches titles that differ only by spacing or capitals', () => {
    const picked = rankMatches(
      [
        night('a', '2026-10-29T23:00:00Z', 'Dog Sees God'),
        night('b', '2026-10-30T23:00:00Z', '  dog sees   GOD '),
      ],
      standings,
      5,
    );

    expect(picked).toHaveLength(1);
    expect(picked[0].events).toHaveLength(2);
  });

  /** Two different gatherings are still two, however close together. */
  it('does not merge things the host gave different names', () => {
    const picked = rankMatches(
      [
        night('a', '2026-10-29T23:00:00Z', 'Dog Sees God'),
        night('b', '2026-10-29T23:00:00Z', 'Dog Sees God — matinee'),
      ],
      standings,
      5,
    );

    expect(picked).toHaveLength(2);
  });

  /**
   * The card says why it arrived. A reason only one night carries is still a
   * true reason, so dropping it would make that sentence wrong.
   *
   * The tags have to be arranged so the *lower*-scoring night is the one
   * carrying the extra reason — otherwise it sorts first, seeds the run, and
   * the union never runs. A host editing the tags on one night of three is
   * exactly how this arises.
   */
  it('keeps a reason that only a later night carries', () => {
    const picked = rankMatches(
      [
        // Declared yes: scores higher, so it seeds the run.
        event('a', ['Games'], '2026-10-29T23:00:00Z', 'Dog Sees God'),
        // Inferred only: scores lower, and brings a reason the first lacks.
        event('b', ['Music'], '2026-10-30T23:00:00Z', 'Dog Sees God'),
      ],
      standings,
      5,
    );

    expect(picked).toHaveLength(1);
    expect([...picked[0].matched].sort()).toEqual(['Games', 'Music']);
  });

  /**
   * Ordering is by date, not by score.
   *
   * Before grouping, the list is sorted strongest-first — so a night that
   * scores higher arrives ahead of an earlier one. Leaving the run in that
   * order would head the card with Friday above a list starting Thursday.
   */
  it('leads with the soonest night even when a later one scores higher', () => {
    const picked = rankMatches(
      [
        event('oct-29', ['Games'], '2026-10-29T23:00:00Z', 'Dog Sees God'),
        // Games *and* Music: outscores the 29th and sorts ahead of it.
        event('oct-30', ['Games', 'Music'], '2026-10-30T23:00:00Z', 'Dog Sees God'),
      ],
      standings,
      5,
    );

    expect(picked[0].event.id).toBe('oct-29');
    expect(picked[0].events.map((e) => e.id)).toEqual(['oct-29', 'oct-30']);
  });

  /** An ordinary gathering is a run of one, so there is one shape downstream. */
  it('gives a single gathering the same shape as a run', () => {
    const picked = rankMatches([event('solo', ['Games'])], standings, 5);

    expect(picked[0].events).toEqual([picked[0].event]);
  });
});
