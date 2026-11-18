/**
 * What an admin needs to know about an event at a glance (CAL-16).
 *
 * The console's card carried one badge — Published or Draft — and that was
 * the whole of what it said about an event's standing. So a cancelled event
 * looked exactly like a live one, and an event cancelled *in Google* looked
 * exactly like one somebody here had called off.
 *
 * Charley, 2026-11-18: "If an event gets cancelled in the Google Calendar,
 * after the sync, if the event was already present in MaybeOS, provide a tag
 * that the admin can see to understand this is an orphaned event that was
 * cancelled in the google calendar."
 *
 * Why it mattered: one import pass cancelled 40 future events in a single
 * statement — all of "Board Games Club" and "MaybeItsFate Community
 * Potluck", out to 2028 — because both recurring series had been deleted in
 * Google as duplicates. The sync was right to follow. The console showed
 * forty ordinary-looking published cards.
 *
 * Pure and tested on its own, so the words are decided in one place rather
 * than in a ternary inside the card.
 */

export type Standing = 'orphaned' | 'cancelled' | 'published' | 'draft';

export interface Standable {
  isPublished: boolean;
  canceledAt?: string | null;
  orphanedAt?: string | null;
}

/**
 * The one thing to say about this event.
 *
 * Orphaned beats cancelled, which beats published: the badge answers "what
 * do I do about this?", and only the first of the three has an answer that
 * is not "nothing". An orphan is always also cancelled, so reading them the
 * other way round would mean the tag never appeared.
 */
export function standingOf(event: Standable): Standing {
  if (event.orphanedAt) return 'orphaned';
  if (event.canceledAt) return 'cancelled';
  return event.isPublished ? 'published' : 'draft';
}

/** What the badge says. Sentence case and plain words (DESIGN §8). */
export const STANDING_LABEL: Record<Standing, string> = {
  orphaned: 'Deleted in Google',
  cancelled: 'Cancelled',
  published: 'Published',
  draft: 'Draft',
};

/**
 * Amber for the one that wants a decision, grey for the ones that do not.
 *
 * Deliberately not red: nothing has gone wrong. A co-op tidying duplicates
 * out of its own calendar is housekeeping, and an alarming badge on forty
 * cards would teach an organiser to stop reading badges.
 */
export const STANDING_TONE: Record<Standing, string> = {
  orphaned: 'bg-amber-50 text-amber-800',
  cancelled: 'bg-gray-100 text-gray-600',
  published: 'bg-green-50 text-green-700',
  draft: 'bg-gray-100 text-gray-600',
};

export function orphanedAmong(events: Standable[]): number {
  return events.filter((event) => standingOf(event) === 'orphaned').length;
}

/**
 * The note above the list, written once rather than on forty cards.
 *
 * Says what happened, then the three things that can be done about it, in
 * the order Charley put them — hide, delete, or put it back in Google. The
 * last one needs no action here at all: the next sync clears the tag by
 * itself, which is worth saying so nobody goes looking for a button.
 *
 * Null when there are none, because a screen should not explain a state it
 * is not in (DESIGN §7).
 */
export function orphanedNote(count: number): string | null {
  if (count < 1) return null;

  const these = count === 1 ? 'One event here was' : `${count} events here were`;
  const them = count === 1 ? 'it' : 'them';

  return (
    `${these} deleted in your Google Calendar, so the copy in MaybeOS is ` +
    `left over. Hide or delete ${them} here, or put ${them} back in Google ` +
    `Calendar and the next sync will clear this by itself.`
  );
}
