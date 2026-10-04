/**
 * The emoji somebody may leave on a message (CMN-17).
 *
 * The same list the API enforces. A fixed set, not free text: an arbitrary
 * string is a cross-site scripting hole wearing a hat, and a free picker means
 * the same feeling arrives as six different glyphs and nothing groups.
 */
export const REACTIONS = ['👍', '❤️', '🎉', '😂', '🙏', '👀'] as const;

export interface ReactionGroup {
  emoji: string;
  count: number;
  /** Whether the reader is one of the people who left it. */
  mine: boolean;
}

/**
 * What a reaction pill says to a screen reader.
 *
 * The visible pill is an emoji and a numeral, which is announced as the
 * emoji's own name followed by a bare number — "thumbs up 3" — and does not
 * say what pressing it would do.
 */
export function reactionLabel(group: ReactionGroup): string {
  const people = `${group.count} ${group.count === 1 ? 'person' : 'people'}`;
  return group.mine
    ? `${people}, including you. Press to take yours back.`
    : `${people}. Press to add yours.`;
}

/**
 * The list after a press, without waiting for the server.
 *
 * A reaction that takes a round trip to appear feels broken, and this is the
 * one interaction in the product somebody does several times in a row. The
 * server's answer replaces this when it lands.
 */
export function toggled(groups: ReactionGroup[], emoji: string): ReactionGroup[] {
  const existing = groups.find((g) => g.emoji === emoji);

  if (!existing) return [...groups, { emoji, count: 1, mine: true }];

  if (existing.mine) {
    // Taking back the only one removes the pill rather than leaving a zero.
    if (existing.count <= 1) return groups.filter((g) => g.emoji !== emoji);
    return groups.map((g) =>
      g.emoji === emoji ? { ...g, count: g.count - 1, mine: false } : g,
    );
  }

  return groups.map((g) => (g.emoji === emoji ? { ...g, count: g.count + 1, mine: true } : g));
}
