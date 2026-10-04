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
export type UnreadKey = 'messages' | 'commons';

export interface UnreadCounts {
  messages: number;
  commons: number;
}

export const NO_UNREAD: UnreadCounts = { messages: 0, commons: 0 };

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
  const thing = what === 'messages' ? 'unread message' : 'unread post';
  return `${count} ${thing}${count === 1 ? '' : 's'}`;
}

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
