import { REACTIONS, groupReactions, isAllowedReaction, isQuickReaction } from '../reactions';

/**
 * Any emoji, not six of them (CMN-21).
 *
 * Charley: "offer an emoji picker so people can get creative with their emoji
 * responses." The closed list existed for three stated reasons, and opening it
 * answers one of them rather than ignoring it: "an arbitrary string is a
 * cross-site scripting hole wearing a hat" is handled by the *shape* a
 * reaction must have, which is the same rule a channel emoji passes.
 */
describe('what may be left on a message now', () => {
  it('takes an emoji that was never on the list', () => {
    expect(isAllowedReaction('🔥')).toBe(true);
    expect(isAllowedReaction('🌱')).toBe(true);
    expect(isAllowedReaction('🤣')).toBe(true);
  });

  it('takes the multi-codepoint ones people are proudest of', () => {
    // A family is seven code points, a flag is two, and a skin tone is a
    // modifier. Refusing these would refuse the creativity that was asked for.
    expect(isAllowedReaction('👨‍👩‍👧‍👦')).toBe(true);
    expect(isAllowedReaction('🇬🇧')).toBe(true);
    expect(isAllowedReaction('👍🏽')).toBe(true);
  });

  it('refuses anything with a word in it', () => {
    /*
      The safety half. A reaction is rendered under somebody's post, so a free
      string is a way to write there without writing a comment — and the
      original note called an arbitrary string "a cross-site scripting hole
      wearing a hat".
    */
    expect(isAllowedReaction('nice')).toBe(false);
    expect(isAllowedReaction('👍 nice')).toBe(false);
    expect(isAllowedReaction('<img src=x onerror=alert(1)>')).toBe(false);
    expect(isAllowedReaction('')).toBe(false);
  });

  it('refuses punctuation pretending to be a face', () => {
    // No pictograph in it, so it is a string of symbols rather than an emoji.
    expect(isAllowedReaction(':-)')).toBe(false);
  });

  it('refuses a sentence of emoji', () => {
    // Capped, because "a single emoji" can legitimately be several code
    // points and illegitimately be a paragraph.
    expect(isAllowedReaction('🎉'.repeat(30))).toBe(false);
  });

  it('still knows which six are offered first', () => {
    expect(isQuickReaction('👍')).toBe(true);
    expect(isQuickReaction('🔥')).toBe(false);
    expect(REACTIONS).toHaveLength(6);
  });
});

describe('the order they come back in', () => {
  const rows = (pairs: Array<[string, string]>) =>
    pairs.map(([emoji, userId]) => ({ emoji, userId }));

  it('keeps the offered six in their own order, ahead of everything else', () => {
    /*
      `indexOf` alone answered -1 for anything off the list, which sorted every
      improvised emoji *ahead* of 👍 — so adding 🔥 to a post reshuffled it.
    */
    const groups = groupReactions(
      rows([['🔥', 'a'], ['👍', 'b'], ['❤️', 'c']]),
      'a',
    );

    expect(groups.map((g) => g.emoji)).toEqual(['👍', '❤️', '🔥']);
  });

  it('ranks the rest by how many chose it', () => {
    const groups = groupReactions(
      rows([['🌱', 'a'], ['🔥', 'b'], ['🔥', 'c']]),
      'a',
    );

    expect(groups.map((g) => g.emoji)).toEqual(['🔥', '🌱']);
  });

  it('breaks a tie on the emoji itself, so it never reshuffles', () => {
    /*
      Neither reaction table stores a timestamp, so rows arrive in whatever
      order Postgres hands them over. Ordering the tail by anything derived
      from the query would move between page loads; count and codepoint are
      properties of the data.
    */
    const once = groupReactions(rows([['🌱', 'a'], ['🔥', 'b']]), 'a');
    const again = groupReactions(rows([['🔥', 'b'], ['🌱', 'a']]), 'a');

    expect(once.map((g) => g.emoji)).toEqual(again.map((g) => g.emoji));
  });

  it('still says which are the reader\u2019s own', () => {
    const groups = groupReactions(rows([['🔥', 'me'], ['🔥', 'you']]), 'me');

    expect(groups[0]).toEqual({ emoji: '🔥', count: 2, mine: true });
  });
});
