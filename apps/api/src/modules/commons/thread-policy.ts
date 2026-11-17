/**
 * When something the co-op is putting on gets a thread in the Commons, and
 * which channel it lands in (CMN-22).
 *
 * Charley, 2026-11-17: "Anytime a new event or teaching offering is shared to
 * members of the co-op, add this as a timeline post in the Commons in either
 * the #Events channel or the #Teaching channel... This should make it easy
 * for members to reply to ask questions."
 *
 * Pure, and separate from the service that writes the rows, because every
 * decision here is one somebody will want to re-read: a wrong "yes" puts a
 * private evening in the channel the whole co-op reads, and a wrong "no"
 * means nobody hears about anything.
 */

/** The two channels this feature keeps. */
export type ThreadChannel = 'events' | 'teaching';

export interface ChannelShape {
  slug: string;
  name: string;
  emoji: string;
  description: string;
}

/**
 * The standard channels, by name and slug.
 *
 * `slug` is what `(orgId, slug)` is unique on, so it is the thing that
 * actually decides whether a co-op already has one. The name and emoji are
 * only what a co-op sees on the day it is created — an admin who renames
 * "Events" to "What's On" keeps their name, because the upsert matches on
 * slug and updates nothing.
 */
export const THREAD_CHANNELS: Record<ThreadChannel, ChannelShape> = {
  events: {
    slug: 'events',
    name: 'Events',
    emoji: '📅',
    description: 'Conversation about what the co-op has coming up.',
  },
  teaching: {
    slug: 'teaching',
    name: 'Teaching',
    emoji: '🎓',
    description: 'Workshops and lessons people here are offering.',
  },
};

/**
 * What is being announced, as much of it as this decision needs.
 *
 * Deliberately not the Prisma row: the two callers hold different models, and
 * a function that took both would be two functions sharing a name.
 */
export interface Announceable {
  isPublished: boolean;
  visibility: 'PUBLIC' | 'MEMBERS_ONLY' | 'PRIVATE';
  /** Whether a thread already exists — for the series, not just this row. */
  alreadyThreaded: boolean;
  /**
   * Set when this event is one of a teaching offering's dates.
   *
   * Those never announce themselves into #Events: the offering has already
   * said what it is in #Teaching, and a six-week workshop would otherwise
   * put one post in #Teaching and six in #Events, splitting the questions
   * across seven threads.
   */
  belongsToOffering?: boolean;
}

/**
 * Whether this should get a thread now.
 *
 * **A draft never announces.** That is the whole point of a draft, and TCH-02
 * leans on it: a workshop written up with its dates holds them back until it
 * is published.
 *
 * **PRIVATE never announces.** EVT-42 already refused these on the lazy path
 * — "#Events is read by every member of the co-op, and posting one there
 * would be the product overriding a member's own answer about who can see
 * it". The same sentence applies to a workshop somebody kept off the lists.
 *
 * **Announcing happens once.** Unpublishing and republishing must not post
 * twice, and neither must the twelve evenings of a repeating series: they
 * share a thread through the series root.
 */
export function shouldAnnounce(subject: Announceable): boolean {
  if (!subject.isPublished) return false;
  if (subject.visibility === 'PRIVATE') return false;
  if (subject.alreadyThreaded) return false;
  if (subject.belongsToOffering) return false;

  return true;
}

/** Why it did not announce, for a log somebody will read at 2am. */
export function whyNotAnnounced(subject: Announceable): string | null {
  if (!subject.isPublished) return 'still a draft';
  if (subject.visibility === 'PRIVATE') return 'kept off the lists';
  if (subject.alreadyThreaded) return 'already has a thread';
  if (subject.belongsToOffering) return 'a date on an offering that has its own thread';

  return null;
}

/**
 * The event whose thread a series shares (CMN-22).
 *
 * `repeat()` points every child at the series root through `parentEventId`,
 * and `Event.postId` is unique — so one post cannot be shared by twelve rows
 * even if we wanted it to be. The thread therefore lives on the root and
 * every date resolves to it.
 *
 * Charley chose this over a post per date: twelve near-identical posts in a
 * row is how a channel gets muted.
 */
export function threadOwnerId(event: { id: string; parentEventId?: string | null }): string {
  return event.parentEventId ?? event.id;
}
