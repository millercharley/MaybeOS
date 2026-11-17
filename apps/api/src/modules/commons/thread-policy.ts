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

/**
 * Who is told that somebody replied (CMN-22).
 *
 * Charley: "The host of the event or the teaching workshop or private lesson
 * should get an email when people reply to their event or teaching session."
 *
 * One person, and only when there is something to tell them. A host replying
 * in their own thread must not be emailed about it — that is the failure
 * this is a named function to prevent, because it is invisible in testing
 * (the developer is always the host) and obvious to everybody else.
 *
 * Everyone else following the conversation is served by the Commons itself.
 * Emailing every participant on every reply is a mailing list nobody asked
 * to join, and Charley's rule for them is narrower still: a non-host hears
 * about an event they RSVP'd to, or a reply to something they wrote.
 */
export function whoHearsAboutReply(thread: {
  /** The event's host, or the offering's teacher. */
  ownerId: string | null | undefined;
  replierId: string;
}): string | null {
  if (!thread.ownerId) return null;
  if (thread.ownerId === thread.replierId) return null;

  return thread.ownerId;
}

/**
 * Whether a member has a stake in one of these threads (CMN-22).
 *
 * Charley: "For a non-host of an event or teaching session: only events that
 * you RSVP'd and/or your messages that get replies should signal a new
 * message alert."
 *
 * #Events and #Teaching fill up on their own — every published event lands
 * there — so counting them like an ordinary channel would give every member
 * a badge that never clears and that none of them asked for. A badge nobody
 * acts on is one people learn to ignore, which is the argument CMN-25
 * already made about counting a co-op's whole history.
 *
 * So these two channels signal only to people with a reason to care. Every
 * one of these is already a row somewhere — nothing new is stored to know
 * it.
 */
export function hasStakeInThread(stake: {
  /** Running it: the event's host or co-host, or the offering's teacher. */
  isOwner?: boolean;
  /** Said they are coming. */
  hasRsvp?: boolean;
  /** Put their hand up for a workshop or asked about lessons. */
  registeredInterest?: boolean;
  /** Already said something in this thread, so a reply may be to them. */
  hasWritten?: boolean;
}): boolean {
  return Boolean(
    stake.isOwner || stake.hasRsvp || stake.registeredInterest || stake.hasWritten,
  );
}

/**
 * Whether a brand-new announcement should signal to anybody.
 *
 * It should not, and this says so out loud rather than by omission. A new
 * event cannot have an RSVP yet and a new workshop cannot have anybody
 * interested, so by Charley's rule there is nobody with a stake in it — it
 * appears in the channel for people who go looking, and nothing lights up.
 *
 * The replies are what signal.
 */
export const ANNOUNCEMENTS_SIGNAL_TO_NOBODY = true;

/**
 * A reply, short enough to put in an email (CMN-22).
 *
 * Comment bodies are HTML — members write them in the rich composer, so a
 * reply can carry tags, links and pasted formatting (CMP-01). Dropped to
 * plain text here because the email template escapes what it is given: left
 * as HTML it would arrive as visible angle brackets, and unescaped it would
 * put a member's markup inside ours.
 *
 * Truncated because the point is to say what was asked, not to reproduce the
 * thread. The link goes to the Commons.
 */
export function excerptOf(html: string, limit = 280): string {
  const text = html
    // Block-level ends become spaces, so two paragraphs do not run together
    // into one word.
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= limit) return text;

  /*
    Cut at a word rather than mid-syllable, but only if there is a space
    reasonably near the end — a single 400-character word is better cut
    bluntly than shown as nothing.
  */
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit - 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
