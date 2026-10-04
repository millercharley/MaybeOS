/**
 * The emoji somebody may leave on a message (CMN-17).
 *
 * A fixed set, not free text. Three reasons, in order of how badly each one
 * ends: an arbitrary string is a cross-site scripting hole wearing a hat; a
 * free picker means the same feeling arrives as six different glyphs and
 * nothing groups; and a co-op is a room full of people who know each other,
 * where the useful reactions are the short ones.
 */
export const REACTIONS = ['👍', '❤️', '🎉', '😂', '🙏', '👀'] as const;

export type ReactionEmoji = (typeof REACTIONS)[number];

export function isAllowedReaction(emoji: string): emoji is ReactionEmoji {
  return (REACTIONS as readonly string[]).includes(emoji);
}

/** Reactions grouped for display: one row per emoji, with who left it. */
export function groupReactions(
  rows: { emoji: string; userId: string }[],
  viewerId: string,
): { emoji: string; count: number; mine: boolean }[] {
  const by = new Map<string, { emoji: string; count: number; mine: boolean }>();

  for (const row of rows) {
    const seen = by.get(row.emoji) ?? { emoji: row.emoji, count: 0, mine: false };
    seen.count += 1;
    if (row.userId === viewerId) seen.mine = true;
    by.set(row.emoji, seen);
  }

  // The order they are offered in, so a message's reactions do not reshuffle
  // as people add to them.
  return [...by.values()].sort(
    (a, b) => REACTIONS.indexOf(a.emoji as ReactionEmoji) - REACTIONS.indexOf(b.emoji as ReactionEmoji),
  );
}
