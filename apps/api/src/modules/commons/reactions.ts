import { isEmoji } from '../../common/emoji';

/**
 * The emoji offered first, and the rule for all the rest (CMN-17, CMN-21).
 *
 * This was a closed list of six, for three stated reasons. Charley: "offer an
 * emoji picker so people can get creative with their emoji responses." Two of
 * those reasons were worth keeping and one was worth answering properly.
 *
 * **The safety one is answered by the shape, not by the list.** "An arbitrary
 * string is a cross-site scripting hole wearing a hat" — so what arrives is
 * held to `EMOJI_PATTERN`, the same rule a channel emoji passes: at least one
 * pictograph or flag, joiners and modifiers allowed, nothing with a word
 * character or a space in it, capped at 24 code points. A reaction cannot be
 * used to write a sentence under somebody's post.
 *
 * **The grouping one is a real cost, knowingly taken.** The same feeling can
 * now arrive as 😂 and 🤣 and group as two. These six stay the ones offered
 * first, which is what keeps the common case converging.
 */
export const REACTIONS = ['👍', '❤️', '🎉', '😂', '🙏', '👀'] as const;

export type ReactionEmoji = (typeof REACTIONS)[number];

/** One of the six offered first. Not a limit — see `isAllowedReaction`. */
export function isQuickReaction(emoji: string): emoji is ReactionEmoji {
  return (REACTIONS as readonly string[]).includes(emoji);
}

/** Anything that is an emoji at all, which is now the whole rule (CMN-21). */
export function isAllowedReaction(emoji: string): boolean {
  return isEmoji(emoji);
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

  /*
    The six offered first in their own order, then everything else by how many
    chose it (CMN-21).

    `indexOf` alone returned -1 for anything off the list, which sorted every
    improvised emoji *ahead* of 👍. Insertion order is not available to fall
    back on — neither reaction table stores a timestamp, so the rows arrive in
    whatever order Postgres hands them over, and a tail ordered that way would
    reshuffle between page loads.

    So the tail is ranked by count, and ties by the emoji itself. Both are
    properties of the data rather than of the query, which is what makes the
    order the same every time somebody opens the post.
  */
  const rank = (emoji: string) => {
    const quick = REACTIONS.indexOf(emoji as ReactionEmoji);
    return quick === -1 ? REACTIONS.length : quick;
  };

  return [...by.values()].sort(
    (a, b) =>
      rank(a.emoji) - rank(b.emoji) ||
      b.count - a.count ||
      (a.emoji < b.emoji ? -1 : a.emoji > b.emoji ? 1 : 0),
  );
}
