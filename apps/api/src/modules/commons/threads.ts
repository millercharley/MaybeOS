/**
 * The rules a conversation follows (CMN-16).
 *
 * Pure, and apart from the service, because the judgement here is in the
 * edges: who counts as being in a conversation, when two selections are the
 * same conversation, and what a group is called before anybody names it.
 * None of that needs a database to be wrong.
 */

/** Nobody needs a hundred people on one thread; that is what a channel is. */
export const MAX_PARTICIPANTS = 20;

/**
 * The fingerprint of a set of people.
 *
 * Sorted, so the same people chosen in a different order are the same
 * conversation — this is what makes "message these three again" land in the
 * thread that already exists rather than opening a second one beside it.
 */
export function participantKey(userIds: string[]): string {
  return [...new Set(userIds)].sort().join(',');
}

export type RecipientProblem = string | null;

/**
 * Whether this is a conversation that can exist.
 *
 * The sender is always a participant, so the list given here is everyone
 * *else*. One name is a DM, several are a group, none is nothing.
 */
export function recipientProblem(
  senderId: string,
  recipientIds: string[],
  knownMemberIds: string[],
): RecipientProblem {
  const others = [...new Set(recipientIds)].filter((id) => id !== senderId);

  if (others.length === 0) {
    return 'Choose at least one person to write to.';
  }
  if (others.length + 1 > MAX_PARTICIPANTS) {
    return `A conversation can hold ${MAX_PARTICIPANTS} people. For more than that, post in a channel.`;
  }

  // Everybody must be in this co-op. A recipient id comes from the request,
  // and without this a member of one co-op could open a conversation with
  // somebody they cannot see (CMN-08).
  const known = new Set(knownMemberIds);
  const strangers = others.filter((id) => !known.has(id));
  if (strangers.length > 0) {
    return 'Somebody you chose is not a member of this co-op.';
  }

  return null;
}

/** Everyone in the conversation, the sender included, deduplicated. */
export function everyone(senderId: string, recipientIds: string[]): string[] {
  return [...new Set([senderId, ...recipientIds])];
}

/**
 * What to call a thread nobody has named.
 *
 * From the point of view of the person reading it, so their own name is left
 * out — a conversation called "Charley, Rebecca" in Charley's own list tells
 * him one thing he knows and one he wants.
 *
 * Three names, then a count. "Rebecca, Eddie, Derek and 4 others" is a
 * conversation somebody recognises; eight full names is a wall.
 */
export function threadName(
  people: { userId: string; name?: string | null }[],
  viewerId: string,
  title?: string | null,
): string {
  if (title?.trim()) return title.trim();

  const others = people.filter((p) => p.userId !== viewerId);
  const names = others.map((p) => p.name?.trim() || 'Someone');

  if (names.length === 0) return 'Just you';
  if (names.length <= 3) {
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }

  const rest = names.length - 3;
  return `${names.slice(0, 3).join(', ')} and ${rest} other${rest === 1 ? '' : 's'}`;
}

/** A DM is a thread with two people in it. Nothing else distinguishes them. */
export function isGroup(participantCount: number): boolean {
  return participantCount > 2;
}

/**
 * How many messages in a thread this person has not read.
 *
 * Their own never count — writing something is not a thing you then have to
 * go and read — and a participant who has never opened the thread has read
 * none of it rather than all of it.
 */
export function unreadIn(
  messages: { senderId: string; createdAt: Date }[],
  viewerId: string,
  lastReadAt: Date | null,
): number {
  return messages.filter(
    (m) => m.senderId !== viewerId && (lastReadAt === null || m.createdAt > lastReadAt),
  ).length;
}
