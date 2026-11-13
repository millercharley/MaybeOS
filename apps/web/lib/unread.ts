/**
 * The badges in the sidebar (CMN-14).
 *
 * Charley: "when there's an unread message in the Commons or Messages, a red
 * bubble appears in the navigation panel with a number indicating how many
 * messages need to be reviewed."
 *
 * Pure, and separate from the sidebar, because the judgement in a badge is in
 * the edges: what it says at zero, what it says at four hundred, and what a
 * screen reader hears. Those are the things worth testing, and none of them
 * need React.
 */

/** Above this the exact number stops being information and becomes noise. */
export const BADGE_MAX = 99;

/** Which nav items carry a count. */
/**
 * What a red bubble in the nav can be counting.
 *
 * `tasks` is the getting-started checklist (ONB-02), which is not unread
 * anything — it is work still to do. It shares this type because it shares
 * the badge: a member reading the nav is being told "there are three of
 * something here", and the product should not have two different-looking
 * ways of saying that.
 */
export type UnreadKey = 'messages' | 'commons' | 'tasks';

export interface UnreadCounts {
  messages: number;
  commons: number;
  /**
   * The Commons total, split by channel (CMN-27).
   *
   * Optional because an API older than this page does not send it, and a
   * missing breakdown should mean "no dots" rather than a crash. Channels
   * with nothing unread are absent, not zero.
   */
  channels?: Record<string, number>;
}

export const NO_UNREAD: UnreadCounts = { messages: 0, commons: 0, channels: {} };

/**
 * How many unread things are in one channel (CMN-27).
 *
 * The badge in the sidebar was a number nobody could act on: it said 2, and
 * the Commons page gave no hint which of the co-op's channels held them — so
 * a member opened the Commons, read whichever channel it landed on, and the 2
 * stayed. This is what lets the channel list say where.
 */
export function unreadInChannel(channelId: string, counts: UnreadCounts): number {
  return counts.channels?.[channelId] ?? 0;
}

/**
 * How often to ask again (CMN-29).
 *
 * The badge polled every sixty seconds for as long as a tab was open, and
 * each poll costs seven database queries — five for the Commons, two for
 * messages. Measured over ninety minutes on production: 417 polls, about
 * 2,900 queries, to render a number that changed **twice**.
 *
 * Express answers 304 for the unchanged ones, which saved the bandwidth and
 * none of the work: the handler has already run every query, serialised the
 * result and hashed it by the time it discovers nothing is different.
 *
 * So the interval backs off while nothing is happening and snaps back the
 * moment something does. A co-op having a conversation keeps a live badge; a
 * tab left open on a quiet afternoon stops asking every minute.
 */
export const POLL_BASE_MS = 60_000;

/**
 * Five minutes is the ceiling, not an hour.
 *
 * This is a badge somebody glances at, not a notification they are waiting
 * on — but a member who comes back to a tab and sees nothing new for ten
 * minutes would reasonably conclude the feature is broken. Returning to the
 * tab resets it anyway, so this only governs how stale a *watched* tab gets.
 */
export const POLL_MAX_MS = 300_000;

export function nextPollDelay(previous: number, changed: boolean): number {
  if (changed) return POLL_BASE_MS;
  return Math.min(previous * 2, POLL_MAX_MS);
}

/**
 * Whether two readings say the same thing.
 *
 * Compared by value rather than by identity: the API builds a fresh object
 * every time, so `!==` would report a change on every single poll and the
 * backoff would never back off.
 */
export function sameCounts(a: UnreadCounts, b: UnreadCounts): boolean {
  if (a.messages !== b.messages || a.commons !== b.commons) return false;

  const left = a.channels ?? {};
  const right = b.channels ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);

  // A channel that went from 2 to 0 leaves the map entirely (CMN-27), so the
  // keys have to be unioned rather than walked from one side.
  for (const key of keys) {
    if ((left[key] ?? 0) !== (right[key] ?? 0)) return false;
  }

  return true;
}

/**
 * What the bubble reads.
 *
 * `99+` rather than `427`, because the difference between those two numbers
 * changes nothing a member does — both mean "more than you are going to read
 * now" — and a four-digit pill wrecks the row it sits in.
 */
export function badgeLabel(count: number): string {
  return count > BADGE_MAX ? `${BADGE_MAX}+` : String(count);
}

/**
 * What a screen reader says.
 *
 * The visible pill is a bare numeral, which on its own is announced as part
 * of the link text — "Messages 3" — and means nothing. The real count goes
 * here, in words, including the ones above the cap.
 */
export function badgeDescription(count: number, what: UnreadKey): string {
  const [one, many] = BADGE_NOUNS[what];
  return `${count} ${count === 1 ? one : many}`;
}

/*
  Spelled out both ways rather than built by adding an "s".

  The noun used to be pluralised by suffix, which works for "unread message"
  and stops working the moment a phrase has its tail somewhere other than the
  end: "step still to do" would have become "step still to dos". Any later
  key with a preposition in it would have hit the same wall silently, in a
  string only a screen-reader user ever hears.
*/
const BADGE_NOUNS: Record<UnreadKey, [singular: string, plural: string]> = {
  messages: ['unread message', 'unread messages'],
  commons: ['unread post', 'unread posts'],
  tasks: ['step still to do', 'steps still to do'],
};

/** Whether to draw anything at all. Zero is not a badge, it is a clean slate. */
export function hasUnread(count: number | undefined): boolean {
  return (count ?? 0) > 0;
}

/**
 * The count for a nav item, by its href.
 *
 * `NavItem` carries no runtime data by design — `sidebarSections()` is pure
 * and has no token, org or network — so the sidebar matches on the route
 * instead. The suffix, not the whole path: the same item is `/portal/<slug>/
 * messages` for every co-op.
 */
export function unreadFor(href: string, counts: UnreadCounts): number {
  if (href.endsWith('/messages')) return counts.messages;
  if (href.endsWith('/commons')) return counts.commons;
  return 0;
}

/** Which of the two a route is, for the screen-reader wording. */
export function unreadKeyFor(href: string): UnreadKey | null {
  if (href.endsWith('/messages')) return 'messages';
  if (href.endsWith('/commons')) return 'commons';
  return null;
}

/**
 * The roll-up for a collapsed section.
 *
 * A collapsed section unmounts its links, so a badge on Messages is invisible
 * exactly when the member is not looking at the Commons — which is most of
 * the time, and precisely when an unread message matters most. The header
 * carries the total of what it is hiding.
 */
export function sectionUnread(hrefs: string[], counts: UnreadCounts): number {
  return hrefs.reduce((sum, href) => sum + unreadFor(href, counts), 0);
}
