/**
 * Somebody else who may manage a room reservation (SPC-37).
 *
 * Charley: "As a member, I want to add a co-host to a room reservation."
 *
 * An event has had co-hosts since EVT-32, and the reservation holding the room
 * for that event has not — so the member who books the Attic every Tuesday was
 * the only person who could move it, and the only person it appeared to. Two
 * people run the evening and one of them cannot see the room is held.
 *
 * It is also the answer to a gap `attachProblem` already names out loud. An
 * event may only claim reservations belonging to the people running it, and
 * the refusal it gives is "That reservation belongs to somebody who is not
 * running this event. **Add them as a co-host first.**" — advice that worked
 * in one direction only: you could add them to the event, but not to the
 * reservation.
 *
 * **What a co-host may do is what the owner may do, minus deciding who else
 * is on it.** Exactly the line `host-control.ts` draws for events: being asked
 * to help run an evening is not being given the power to hand it to somebody
 * else, or to remove the person who asked you. So a co-host can move the
 * reservation, cancel it, and publish it as an event; they cannot add or drop
 * another co-host.
 */

export interface BookingActorView {
  /** Whose reservation it is. */
  userId: string;
  coHostIds: string[];
}

/**
 * Whether they may change the reservation — move it, cancel it, publish it.
 *
 * Organisers may because sorting out the building's calendar is their job,
 * which is the rule `loadBookingForActor` already had.
 */
export function canChangeBooking(
  booking: BookingActorView,
  userId: string,
  isStaff: boolean,
): boolean {
  if (isStaff) return true;
  if (booking.userId === userId) return true;

  return booking.coHostIds.includes(userId);
}

/** Why they cannot, in words somebody can act on. */
export const NOT_YOUR_BOOKING =
  'This is not your reservation. Whoever booked the room can add you to it.';

/**
 * Whether they may decide who else is on it.
 *
 * The owner and organisers only. A co-host is deliberately not included: the
 * person who asked for help must stay the person who can un-ask.
 */
export function canManageBookingCoHosts(
  booking: BookingActorView,
  userId: string,
  isStaff: boolean,
): boolean {
  return isStaff || booking.userId === userId;
}

export const NOT_YOURS_TO_SHARE =
  'Only whoever booked the room, or an organiser, can change who is on this reservation.';

/**
 * Why somebody cannot be added, or null when they can.
 *
 * The owner is not a co-host of their own reservation — the line would read
 * "booked by Ada, with Ada" — and the same person twice is a constraint
 * violation that deserves a sentence instead.
 */
export function bookingCoHostProblem(
  booking: BookingActorView,
  userId: string,
): string | null {
  if (booking.userId === userId) {
    return 'They booked this room, so it is already theirs.';
  }
  if (booking.coHostIds.includes(userId)) {
    return 'They are already on this reservation.';
  }

  return null;
}

/**
 * Whether a reservation a co-op made can be shared at all (SPC-23).
 *
 * A co-op hold blocks the room without being anybody's booking — MaybeItsFate
 * has 3,017 of them — so there is no "us" for somebody to be added to. An
 * organiser wanting a member on one should hand them the room, not a share of
 * a hold that is in nobody's My Bookings.
 */
export const COOP_HOLD_CANNOT_BE_SHARED =
  'That is a hold the co-op made rather than somebody’s reservation, so there is nobody to add anyone to.';
