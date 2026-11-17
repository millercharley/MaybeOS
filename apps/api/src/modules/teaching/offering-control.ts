/**
 * Who may change an offering, and who may see one (TCH-01).
 *
 * Charley, 2026-11-17: members should be able to broadcast something they plan
 * to teach, or are willing to teach.
 *
 * Every decision in this file is a policy decision and none of them needs a
 * database, so they live here as pure functions — the same arrangement
 * `host-control.ts` and `event-removal.ts` use in the events module, and for
 * the same reason: a predicate buried in a service method is a predicate that
 * is only ever exercised through a Prisma mock.
 */

export type OfferingVisibility = 'PUBLIC' | 'MEMBERS_ONLY' | 'PRIVATE';

export interface OfferingControl {
  teacherId: string;
  createdById: string | null;
}

/**
 * Who may edit.
 *
 * Two answers, and the second is the one worth writing down. The teacher can,
 * because it is their offering. The **creator** can, which is not implied by
 * the first: an organiser may write up an offering on a member's behalf — a
 * member who teaches pottery and does not use the web app much — and without
 * this they would lose the ability to correct it the moment they named the
 * teacher. The same distinction `Event.hostId` and `Event.createdById` draw
 * (EVT-32), for the same reason.
 *
 * Organisers can, because running what the co-op publishes is their job.
 */
export function canEditOffering(
  offering: OfferingControl,
  userId: string,
  isOrganiser: boolean,
): boolean {
  if (isOrganiser) return true;
  if (offering.teacherId === userId) return true;

  return Boolean(offering.createdById && offering.createdById === userId);
}

/** Why they cannot, in words somebody can act on. */
export const NOT_YOUR_OFFERING =
  'Only an organiser, the teacher, or whoever wrote this up can change it.';

/**
 * Who may read the list of people who put their hand up.
 *
 * The same people who may edit. An interest note is a learner writing to the
 * teacher — "I am a complete beginner", "I can only do Tuesdays" — and it is
 * addressed to them, not to the co-op.
 */
export const canSeeInterest = canEditOffering;

export const NOT_YOUR_INTEREST_LIST =
  'Only an organiser, the teacher, or whoever wrote this up can see who has asked.';

export interface OfferingAudience {
  visibility: OfferingVisibility;
  isPublished: boolean;
  closedAt?: Date | string | null;
}

/**
 * Whether an offering is visible to somebody, by audience.
 *
 * Mirrors the rule `listPublicEvents` applies to events, including the part
 * that is easy to get backwards: **PRIVATE means "not advertised", not
 * "sealed"**. It is absent from every list; somebody who already has the link
 * can still open it. That is what the events module means by it and a second
 * meaning for the same word would be worse than either.
 *
 * `viewerIsMember` defaults to false so a forgetful caller leaks nothing —
 * the same default, for the same reason, as `listPublicEvents`.
 */
export function offeringIsListed(
  offering: OfferingAudience,
  viewerIsMember = false,
): boolean {
  if (!offering.isPublished) return false;
  if (offering.visibility === 'PRIVATE') return false;
  if (offering.visibility === 'MEMBERS_ONLY') return viewerIsMember;

  return true;
}

/**
 * The visibilities a given viewer may be shown, for a Prisma `where`.
 *
 * Returned rather than built at each call site, because there are four call
 * sites — the member list, the public list, the embed and the detail read —
 * and four copies of a security predicate is three too many.
 */
export function visibleTo(viewerIsMember: boolean): OfferingVisibility[] {
  return viewerIsMember ? ['PUBLIC', 'MEMBERS_ONLY'] : ['PUBLIC'];
}

/**
 * Whether a workshop has anything on the calendar yet.
 *
 * An offering with no sessions is not broken or half-finished: Charley asked
 * for it explicitly — "not required if just gathering interest or sign ups".
 * So this is a state the product displays, not an error it reports, and the
 * word for it on screen is "gathering interest" rather than "unscheduled",
 * which reads like something went wrong.
 */
export function isScheduled(sessionCount: number): boolean {
  return sessionCount > 0;
}

/** A private lesson never has sessions; a workshop may or may not. */
export function mayHaveSessions(kind: 'WORKSHOP' | 'PRIVATE_LESSON'): boolean {
  return kind === 'WORKSHOP';
}

export const LESSONS_HAVE_NO_SESSIONS =
  'Private lessons are arranged with each person, so they have no scheduled dates. ' +
  'Make this a workshop if you want to put dates on the calendar.';

/**
 * Whether MaybeOS can take the money for this.
 *
 * Paid private lessons are the half of TCH-01 that is not built: a workshop
 * session is an `Event`, so ticketing it works the day this ships, but
 * `Ticket.eventId` and `HostPayout.eventId` are both non-null, so a lesson has
 * nothing to hang a purchase on. The column accepts THROUGH_MAYBEOS already so
 * that turning it on later is a new branch rather than a migration — this is
 * the branch, and it refuses for now rather than offering a checkout that
 * cannot complete.
 */
export function canChargeThroughMaybeOS(
  kind: 'WORKSHOP' | 'PRIVATE_LESSON',
): boolean {
  return kind === 'WORKSHOP';
}

export const LESSONS_NOT_YET_PAYABLE =
  'MaybeOS cannot take payment for private lessons yet. ' +
  'Choose "arrange payment directly" and say what you charge, ' +
  'or make this a workshop with dates to sell tickets.';

/**
 * `title` reduced to a slug, unique per co-op.
 *
 * Deliberately *without* the date prefix `Event` slugs carry. An event is one
 * evening and its slug says which; an offering outlives its sessions and may
 * never have one, so a date in the address would be a lie about half of them.
 *
 * Collisions are resolved by the caller against the compound unique, exactly
 * as `EventsService.create` does.
 */
export function offeringSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** What an offering with an unusable title falls back to. */
export const UNTITLED_SLUG = 'offering';
