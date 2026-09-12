import type { Post, RecentJoins } from './api';

/**
 * One channel's stream: the messages, and the notices that belong among them.
 *
 * Charley, on a welcome card sitting above an August message in a September
 * conversation: notices that appear in the channel should sit in the vertical
 * order everything else does, newest at the bottom. A card pinned to the top
 * of the scroller reads as "this happened before all of this", which for
 * somebody who joined on Thursday is simply untrue.
 *
 * So a notice is placed by the moment it is *about* — a join by when they
 * joined — and the whole lot is sorted as one list. This function exists
 * rather than an inline `.sort()` because it is the place any future notice
 * gets added, and because the ordering is worth testing without a browser.
 */

export type StreamEntry =
  | { kind: 'post'; key: string; at: number; post: Post }
  | {
      kind: 'welcome';
      key: string;
      at: number;
      member: RecentJoins['members'][number];
      /** "and N others this week", carried by the newest welcome only. */
      more: number;
    };

/**
 * Messages and notices in one ascending list.
 *
 * Ascending, because the channel reads upward from the composer: the last
 * entry is the newest and sits nearest the box you type in.
 *
 * A join with an unreadable date is dropped rather than placed at the epoch,
 * which would pin it to the very top of the conversation — the exact bug
 * this function exists to fix, arrived at from the other direction.
 */
export function channelStream(posts: Post[], joins: RecentJoins | null): StreamEntry[] {
  const entries: StreamEntry[] = posts.map((post) => ({
    kind: 'post',
    key: `post-${post.id}`,
    at: time(post.createdAt),
    post,
  }));

  // Newest first from the API, so the last one here is the newest join and
  // the one that carries the overflow count.
  const members = (joins?.members ?? []).filter((m) => Number.isFinite(time(m.joinedAt)));
  members.forEach((member, index) => {
    entries.push({
      kind: 'welcome',
      key: `welcome-${member.membershipId}`,
      at: time(member.joinedAt),
      member,
      more: index === 0 ? joins?.more ?? 0 : 0,
    });
  });

  return entries.sort((a, b) => a.at - b.at || rank(a) - rank(b) || a.key.localeCompare(b.key));
}

/**
 * Posts before notices when the timestamps tie.
 *
 * Arbitrary, and deliberately fixed: two entries on the same second must not
 * swap places between renders, because a list that reorders itself while you
 * read it is worse than either order.
 */
function rank(entry: StreamEntry): number {
  return entry.kind === 'post' ? 0 : 1;
}

function time(value: string): number {
  return new Date(value).getTime();
}
