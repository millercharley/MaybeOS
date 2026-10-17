/**
 * What a member missed while they were away (CMN-20).
 *
 * The second half of Charley's rule: a direct message emails immediately
 * (CMN-19), and the Commons is a weekly digest — "of things you might have
 * missed if you didn't log in this week".
 *
 * The phrase does the work. This is **not** a weekly newsletter: a member who
 * reads the Commons never receives one. It exists for the people who have
 * drifted, which on MaybeItsFate is most of the roster.
 *
 * Everything here is a pure function over rows, because the two decisions
 * that make this useful rather than annoying — who was away, and what is
 * worth repeating — should be readable without a database.
 */

/** How far back a weekly digest looks. */
export const WINDOW_DAYS = 7;

/** The most channels one digest will mention, and the most posts from each. */
export const MAX_CHANNELS = 4;
export const MAX_PER_CHANNEL = 3;

/** The window this run covers. */
export function digestWindow(now: Date, days = WINDOW_DAYS): { since: Date; until: Date } {
  return { since: new Date(now.getTime() - days * 24 * 60 * 60 * 1000), until: now };
}

/**
 * Was this member here at all during the window?
 *
 * Charley chose activity over `lastLoginAt` alone, and he was right to: a
 * member signed in on their phone who reads the Commons every morning may
 * have a `lastLoginAt` from weeks ago, and mailing them a digest of posts
 * they have already read is how a digest gets filtered.
 *
 * Any of four things counts as being here — signing in, opening a channel,
 * opening a conversation, or writing something. Reading is the important one
 * and the one `lastLoginAt` misses entirely.
 */
export function wasHere(
  seen: {
    lastLoginAt?: Date | null;
    lastChannelReadAt?: Date | null;
    lastThreadReadAt?: Date | null;
    lastWroteAt?: Date | null;
  },
  since: Date,
): boolean {
  const at = [seen.lastLoginAt, seen.lastChannelReadAt, seen.lastThreadReadAt, seen.lastWroteAt];
  return at.some((d) => d instanceof Date && d.getTime() >= since.getTime());
}

/**
 * Was this member away for the whole window, and so owed a digest?
 *
 * Reading is tracked per channel and per thread, and writing per post and
 * comment — four tables, none of which carry a single "last seen" column.
 * Rather than four reads per member, the caller asks each table once for
 * *everyone* who was active and hands the answer in as a set; only the
 * sign-in date, which lives on the member's own row, is compared here.
 */
export function isAway(
  member: { userId: string; lastLoginAt: Date | null },
  activeUserIds: ReadonlySet<string>,
  since: Date,
): boolean {
  if (activeUserIds.has(member.userId)) return false;
  return !wasHere({ lastLoginAt: member.lastLoginAt }, since);
}

/** Has this member switched the digest off, in either place they can? */
export function wantsDigest(m: {
  emailOptIn: boolean | null;
  commonsDigestEmails: boolean;
}): boolean {
  // `emailOptIn` is three-valued and null means "never asked", which on a
  // real co-op is almost everybody. Treating it as "no" silences the roster.
  if (m.emailOptIn === false) return false;
  return m.commonsDigestEmails;
}

/** One post, reduced to what a digest prints. */
export interface DigestPost {
  id: string;
  channelId: string;
  channelName: string;
  channelEmoji: string | null;
  authorId: string;
  authorName: string | null;
  title: string | null;
  body: string;
  createdAt: Date;
  commentCount: number;
}

export interface DigestChannel {
  channelId: string;
  channelName: string;
  channelEmoji: string | null;
  /** How many posts the channel had in the window, including the ones cut. */
  total: number;
  posts: DigestPost[];
}

/**
 * What one member's digest says.
 *
 * Their own posts are left out: a letter telling somebody what they
 * themselves wrote last week is the clearest possible signal that nobody is
 * reading what they send.
 *
 * Busiest channels first, and capped in both directions. A digest that
 * reprints an entire week of a busy Commons is not a digest, and the member
 * who opens it once will not open the next.
 */
export function digestFor(posts: DigestPost[], memberId: string): DigestChannel[] {
  const mine = posts.filter((p) => p.authorId !== memberId);

  const byChannel = new Map<string, DigestChannel>();
  for (const post of mine) {
    const channel = byChannel.get(post.channelId) ?? {
      channelId: post.channelId,
      channelName: post.channelName,
      channelEmoji: post.channelEmoji,
      total: 0,
      posts: [],
    };
    channel.total += 1;
    channel.posts.push(post);
    byChannel.set(post.channelId, channel);
  }

  return [...byChannel.values()]
    .sort((a, b) => b.total - a.total || a.channelName.localeCompare(b.channelName))
    .slice(0, MAX_CHANNELS)
    .map((channel) => ({
      ...channel,
      // Newest first within a channel: what was said most recently is what a
      // member coming back is most likely to still be able to join in with.
      posts: [...channel.posts]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, MAX_PER_CHANNEL),
    }));
}

/** Is there anything here worth sending? */
export function worthSending(channels: DigestChannel[]): boolean {
  return channels.some((c) => c.posts.length > 0);
}

/** How many posts a digest is standing in for, including the ones it cut. */
export function totalPosts(channels: DigestChannel[]): number {
  return channels.reduce((sum, c) => sum + c.total, 0);
}
