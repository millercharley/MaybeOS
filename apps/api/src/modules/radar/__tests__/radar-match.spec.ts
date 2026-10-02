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

const event = (id: string, tags: string[], when = '2026-10-08T18:00:00Z') => ({
  id,
  startTime: at(when),
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
