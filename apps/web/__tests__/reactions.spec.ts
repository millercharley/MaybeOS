import { REACTIONS, reactionLabel, toggled, type ReactionGroup } from '@/lib/reactions';

/**
 * An emoji on any message (CMN-17).
 *
 * Charley: "Make sure people can leave an emoji reaction on any message."
 *
 * The pill is pressed repeatedly and optimistically, so the arithmetic of
 * adding and taking back is the whole of what can go wrong: a count that
 * drifts, a pill that lingers at zero, or one that cannot tell you whether
 * you already pressed it.
 */
const g = (emoji: string, count: number, mine: boolean): ReactionGroup => ({ emoji, count, mine });

describe('pressing a reaction', () => {
  it('adds one nobody has left yet', () => {
    expect(toggled([], '👍')).toEqual([g('👍', 1, true)]);
  });

  it('joins one somebody else left', () => {
    expect(toggled([g('👍', 1, false)], '👍')).toEqual([g('👍', 2, true)]);
  });

  it('takes mine back without removing theirs', () => {
    expect(toggled([g('👍', 3, true)], '👍')).toEqual([g('👍', 2, false)]);
  });

  it('removes the pill rather than leaving a zero', () => {
    // A "👍 0" sitting under a message is a thing people press to find out
    // what it means.
    expect(toggled([g('👍', 1, true)], '👍')).toEqual([]);
  });

  it('leaves the other emoji alone', () => {
    const before = [g('👍', 2, false), g('❤️', 1, true)];
    expect(toggled(before, '👍')).toEqual([g('👍', 3, true), g('❤️', 1, true)]);
  });

  it('lets one person leave several different emoji', () => {
    const after = toggled([g('👍', 1, true)], '🎉');
    expect(after).toEqual([g('👍', 1, true), g('🎉', 1, true)]);
  });

  it('is its own undo', () => {
    // Press, press again, and you are where you started.
    const start = [g('👍', 2, false)];
    expect(toggled(toggled(start, '👍'), '👍')).toEqual(start);
  });
});

describe('what a reaction says out loud', () => {
  it('says what pressing it would do', () => {
    // Announced as written, the pill is "thumbs up 3" — the emoji's own name
    // and a bare number, which does not say it is a button or what it does.
    expect(reactionLabel(g('👍', 3, false))).toMatch(/press to add yours/i);
    expect(reactionLabel(g('👍', 3, true))).toMatch(/take yours back/i);
  });

  it('counts people, in the plural when there are several', () => {
    expect(reactionLabel(g('👍', 1, false))).toContain('1 person');
    expect(reactionLabel(g('👍', 2, false))).toContain('2 people');
  });

  it('says when one of them is you', () => {
    expect(reactionLabel(g('❤️', 2, true))).toContain('including you');
  });
});

describe('the emoji on offer', () => {
  it('is a short fixed set, not a free picker', () => {
    // Free text would be a cross-site scripting hole, and a full picker means
    // the same feeling arrives as six glyphs and nothing groups.
    expect(REACTIONS.length).toBeGreaterThan(2);
    expect(REACTIONS.length).toBeLessThanOrEqual(8);
  });

  it('matches the list the API enforces', () => {
    // Two copies, one on each side of the wire. If they drift, a member
    // presses an emoji the server refuses.
    const api = require('fs').readFileSync(
      require('path').join(__dirname, '../../api/src/modules/commons/reactions.ts'),
      'utf8',
    );
    for (const emoji of REACTIONS) expect(api).toContain(emoji);
  });
});
