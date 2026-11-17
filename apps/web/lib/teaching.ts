import type { Offering } from '@/lib/api';

/**
 * The small decisions the teaching screens keep making (TCH-01).
 *
 * Pure, and here rather than in a component, because each of them is a rule
 * rather than a layout: what an unscheduled workshop is called, whether an
 * offering is taking anybody, and how a typed price becomes cents. The first
 * two are read by three screens each and the third is the kind of parsing
 * that is wrong in an interesting way.
 */

/** Stripe will not take a payment under fifty cents, so zero is not a price. */
export const MIN_PRICE_CENTS = 50;

/**
 * A typed price as cents, or `'invalid'`.
 *
 * Not `null` for a bad one: null already means "free", which is a real and
 * different answer, and a parser that returns the same thing for "the member
 * left it blank" and "the member typed 'forty quid'" makes the second one
 * silently free. The caller distinguishes them.
 *
 * Accepts what people actually type — a leading `$`, a comma, spaces — and
 * rounds rather than truncating, so `19.999` is two pounds short of nothing
 * rather than a cent short of the price.
 */
export function priceFromInput(input: string): number | null | 'invalid' {
  const cleaned = input.trim().replace(/[$,\s]/g, '');
  if (!cleaned) return null;

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return 'invalid';

  const cents = Math.round(Number(cleaned) * 100);
  if (!Number.isFinite(cents) || cents < MIN_PRICE_CENTS) return 'invalid';

  return cents;
}

/** Cents back into something a price field can show. Empty for free. */
export function priceToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2);
}

/**
 * What an offering costs, in a sentence.
 *
 * Four different things, and the order matters. A teacher's own words beat a
 * number, because "sliding scale, pay what you can" is the answer and `$0.00`
 * is not. Free is said out loud rather than shown as a zero, which reads like
 * a bug. And an offering that is not selling tickets says nothing about a
 * price it is not charging.
 */
export function priceLabel(offering: Offering): string {
  if (offering.priceNote) return offering.priceNote;
  if (offering.payment === 'THROUGH_MAYBEOS' && offering.priceCents) {
    return `$${(offering.priceCents / 100).toFixed(2)}`;
  }
  if (offering.kind === 'PRIVATE_LESSON') return 'Ask about rates';

  return 'Free';
}

/**
 * What to call a workshop with no dates on it.
 *
 * "Gathering interest" rather than "unscheduled", which reads like something
 * went wrong. Charley asked for this state explicitly — "not required if just
 * gathering interest or sign ups" — so it is a thing the product says, not a
 * gap it apologises for.
 */
export function scheduleLabel(offering: Offering): string {
  if (offering.kind === 'PRIVATE_LESSON') return 'Arranged with you';

  const count = offering.sessions?.length ?? 0;
  if (count === 0) return 'Gathering interest';

  return count === 1 ? '1 date' : `${count} dates`;
}

/** Whether somebody can still put their hand up. */
export function isOpen(offering: Offering): boolean {
  return Boolean(offering.isPublished ?? true) && !offering.closedAt;
}

/**
 * What the button under an offering says.
 *
 * A workshop with dates sends somebody to the dates, because that is where
 * RSVPs and tickets already live and re-implementing either here would be a
 * second way to do the same thing. Everything else collects an enquiry.
 */
export function actionLabel(offering: Offering): string {
  if (!isOpen(offering)) return 'No longer taking anybody';
  if (offering.kind === 'PRIVATE_LESSON') return 'Ask about lessons';
  if ((offering.sessions?.length ?? 0) > 0) return 'See the dates';

  return "I'd come to this";
}

/**
 * What to put in front of a teacher the moment their workshop goes live
 * (TCH-02).
 *
 * Charley asked for this: after publishing, prompt them to reserve a room or
 * get the workshop onto the events calendar. The second half needed
 * rethinking rather than building, because **a workshop's dates are already
 * events** — publishing the workshop publishes them, and they are on the
 * calendar before any prompt could offer to put them there. So this confirms
 * what just happened and offers the step that is genuinely still open.
 *
 * Returned as a list of names rather than rendered here: the words belong in
 * the component, and a pure list is something a test can hold.
 */
export type PublishedStep = 'calendar' | 'private' | 'needs-room' | 'room';

export interface PublishedShape {
  visibility: 'PUBLIC' | 'MEMBERS_ONLY' | 'PRIVATE';
  sessions?: Array<{ isPublished?: boolean; location?: { name: string } | null }>;
}

export function stepsAfterPublish(offering: PublishedShape): PublishedStep[] {
  const sessions = offering.sessions ?? [];

  /*
    No dates, nothing to say. A workshop gathering interest first is a state
    the product has a name for, and following it with advice about rooms and
    calendars would be answering a question nobody asked.
  */
  if (sessions.length === 0) return [];

  const steps: PublishedStep[] = [];

  /*
    Kept off the lists on purpose, so saying "it's on the calendar" would be
    untrue. Said out loud rather than left silent: a teacher who picked
    PRIVATE weeks ago and has now added dates should find out here, not by
    wondering why nobody came.
  */
  steps.push(offering.visibility === 'PRIVATE' ? 'private' : 'calendar');

  /*
    A date that stayed a draft did so because this co-op asks every event to
    name a room (SPC-27). That is the one thing standing between the date and
    the calendar, so it outranks the optional nudge below.
  */
  const waiting = sessions.filter((session) => session.isPublished === false);
  if (waiting.length > 0) {
    steps.push('needs-room');
    return steps;
  }

  // Offered only where it is still an open question.
  if (sessions.some((session) => !session.location)) steps.push('room');

  return steps;
}

/** How many of a workshop's dates are not on the calendar yet (TCH-02). */
export function datesWaiting(offering: PublishedShape): number {
  return (offering.sessions ?? []).filter((s) => s.isPublished === false).length;
}

/**
 * What is wrong with a date typed into the create form (TCH-02).
 *
 * **The server is the authority**: `sessionDraftProblem` in
 * `apps/api/src/modules/teaching/offering-control.ts` decides what is
 * allowed, and nothing here can let a bad date through. This exists so the
 * common mistake — finish before start — is caught while the teacher is
 * still looking at the field, instead of after they press Create.
 *
 * The messages are deliberately the same words as the server's. The API does
 * not import `@maybeos/shared` anywhere, and adding that dependency for one
 * function would change what the Netlify function bundles, so the two copies
 * live apart. `teaching-next-steps.spec.ts` reads the API file and fails if
 * they stop matching, which is the cheapest honest way to hold it.
 */
export const DATE_PROBLEMS = {
  noTitle: 'Give the date a name, so people know which session it is.',
  unreadable: 'That date did not read as a date. Pick it again.',
  backwards: 'The finish needs to be after the start.',
  noSeats: 'A date with no seats cannot take anybody. Leave it blank for no limit.',
} as const;

export function dateRowProblem(row: {
  title: string;
  startTime: string;
  endTime: string;
  capacity?: number | null;
}): string | null {
  if (!row.title?.trim()) return DATE_PROBLEMS.noTitle;

  const start = new Date(row.startTime);
  const end = new Date(row.endTime);
  if (!row.startTime || !row.endTime || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return DATE_PROBLEMS.unreadable;
  }
  if (end <= start) return DATE_PROBLEMS.backwards;
  if (row.capacity != null && row.capacity < 1) return DATE_PROBLEMS.noSeats;

  return null;
}

/**
 * Which offerings a dashboard showcase should put in front of somebody
 * (TCH-03).
 *
 * The list this is handed is the co-op's own — `listForOrg` — which
 * deliberately carries more than a showcase should: an organiser sees every
 * draft, and a teacher sees their own. Neither belongs on a panel whose job
 * is "here is what people are teaching", so the filtering happens here
 * rather than in the component, where it can be read and tested on its own.
 *
 * **A draft is excluded unless it says it is published.** `isPublished`
 * missing means nobody told us, and a showcase that guesses "yes" publishes
 * somebody's half-written workshop to the whole co-op. The same direction of
 * failure `visibleTo(false)` picks on the server: when unsure, show less.
 *
 * Ranked by what is actually happening. A workshop with an evening next week
 * is something a member can act on today; one gathering interest is an
 * invitation to put a hand up, and sits behind it.
 */
export function showcaseOfferings(
  offerings: Array<Offering>,
  options: { now?: Date; limit?: number } = {},
): Offering[] {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 3;

  const live = offerings.filter(
    (offering) => offering.isPublished === true && !offering.closedAt,
  );

  /*
    Measured from the end, not the start, so an evening that is under way is
    still "next" rather than history — the same rule `hasEnded` holds for
    events (EVT-49).
  */
  const nextAt = (offering: Offering): number | null => {
    const upcoming = (offering.sessions ?? [])
      .filter((session) => new Date(session.endTime).getTime() >= now.getTime())
      .map((session) => new Date(session.startTime).getTime())
      .filter((time) => !Number.isNaN(time));

    return upcoming.length > 0 ? Math.min(...upcoming) : null;
  };

  return live
    .map((offering, index) => ({ offering, index, next: nextAt(offering) }))
    .sort((a, b) => {
      if (a.next !== null && b.next !== null) return a.next - b.next;
      if (a.next !== null) return -1;
      if (b.next !== null) return 1;
      // Neither has a date: keep the order the API gave, which is newest
      // first. A stable tiebreak rather than none, so the panel does not
      // reshuffle itself between renders.
      return a.index - b.index;
    })
    .slice(0, limit)
    .map((row) => row.offering);
}
