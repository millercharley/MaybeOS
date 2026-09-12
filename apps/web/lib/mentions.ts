import { escapeHtml } from './rich-text';

/**
 * Mentions — @ a member, # a channel (CMN-11).
 *
 * Charley, pointing at Circle: a mention should hyperlink to the person or
 * the channel. So a mention is a real anchor in the body, not a marker the
 * reader has to interpret — it survives sanitising, it works in a plain email
 * quote of the body, and middle-clicking it opens what it says it will.
 *
 * The address carries the meaning, because the sanitiser's allowlist is
 * `href`, `title`, `alt`, `src`, `target`, `rel` and nothing else — a
 * `data-member-id` would be stripped on the way out and the mention would
 * render as ordinary blue text. So the id lives in a query parameter that
 * both ends of this file agree on, and `parseMention` is what reads it back.
 */

export type MentionKind = 'member' | 'channel';

export interface MentionPerson {
  id: string;
  name: string;
}

export interface MentionChannel {
  id: string;
  name: string;
  emoji?: string | null;
}

/**
 * Where a mention points.
 *
 * Both are real pages that already read these parameters: the Commons reads
 * `?channel=`, and Members opens a card for `?member=`. That matters for the
 * case where JavaScript does not upgrade the click — the link still lands
 * somewhere true rather than on a page that ignores half its address.
 */
export function mentionHref(kind: MentionKind, orgSlug: string, id: string): string {
  return kind === 'member'
    ? `/portal/${orgSlug}/directory?member=${id}`
    : `/portal/${orgSlug}/commons?channel=${id}`;
}

/** The anchor to insert. The label is escaped: members choose these words. */
export function mentionHtml(kind: MentionKind, orgSlug: string, id: string, label: string): string {
  return `<a href="${mentionHref(kind, orgSlug, id)}">${escapeHtml(label)}</a>`;
}

/**
 * What a mention link refers to, or null if it is an ordinary link.
 *
 * Used by the reader to turn a click on a member mention into the member card
 * every name in MaybeOS opens (MEM-18), rather than a page navigation away
 * from the conversation.
 *
 * Deliberately tolerant of the absolute form: a body can be pasted, quoted or
 * rewritten, and `https://app.maybeos.com/portal/x/directory?member=…` means
 * exactly what the relative version means.
 */
export function parseMention(href: string): { kind: MentionKind; id: string } | null {
  if (!href) return null;

  let path = href;
  let query = '';
  const split = href.indexOf('?');
  if (split >= 0) {
    path = href.slice(0, split);
    query = href.slice(split + 1);
  }
  if (!query) return null;

  const params = new URLSearchParams(query);
  const member = params.get('member');
  const channel = params.get('channel');

  if (member && /\/directory$/.test(path)) return { kind: 'member', id: member };
  if (channel && /\/commons$/.test(path)) return { kind: 'channel', id: channel };
  return null;
}

/**
 * The mention being typed, if one is.
 *
 * Matched against the text before the caret. The trigger has to start a word —
 * without that, an email address turns into a member picker halfway through
 * typing it, which is the single most irritating way to get this wrong.
 *
 * The query is a single word: a space closes the picker. A surname is reached
 * by typing the surname — `matchMentions` matches on any word of a name — and
 * the alternative is a picker that stays open over the rest of the sentence
 * somebody typed after a stray "@".
 */
export function findMentionQuery(
  before: string,
): { trigger: '@' | '#'; query: string; length: number } | null {
  const match = /(^|[\s(])([@#])([^\s@#]{0,40})$/.exec(before);
  if (!match) return null;

  const [, , trigger, query] = match;
  return {
    trigger: trigger as '@' | '#',
    query,
    // What to delete before inserting the anchor: the trigger and the query.
    length: query.length + 1,
  };
}

/** The people or channels a query offers, best first, and never all of them. */
export function matchMentions<T extends { name: string }>(items: T[], query: string, limit = 8): T[] {
  const needle = query.trim().toLowerCase();
  const scored = items
    .map((item) => {
      const name = item.name.toLowerCase();
      if (!needle) return { item, score: 2 };
      if (name.startsWith(needle)) return { item, score: 0 };
      // A word inside the name, so "smith" finds "Ada Smith" — but "mit"
      // does not, because a substring match anywhere turns the picker into
      // noise on short queries.
      if (name.split(/\s+/).some((word) => word.startsWith(needle))) return { item, score: 1 };
      return { item, score: -1 };
    })
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name));

  return scored.slice(0, limit).map((entry) => entry.item);
}

/** How a channel reads in a list and in a mention: its emoji, or a `#`. */
export function channelLabel(channel: MentionChannel): string {
  return channel.emoji ? `${channel.emoji} ${channel.name}` : `#${channel.name}`;
}
