/**
 * Which reservations an event may claim (SPC-27).
 *
 * Charley: "the user can only see rooms they or a co-host has reserved (ask
 * for co-host first)."
 *
 * A reservation is somebody's hold on a room. Letting an event claim one that
 * belongs to a member who knows nothing about it would take their room — so
 * the list an event chooses from is the host's own bookings and those of the
 * people they have already named as co-hosts. Organisers see the co-op's,
 * because sorting out a double-booked evening is their job.
 */

export interface AttachableWho {
  /** Everybody whose reservations this event may claim. */
  userIds: string[];
  /** An organiser sees the co-op's, not only their own. */
  anyone: boolean;
}

export function whoseRoomsCount(
  actor: { userId: string; isOrganiser: boolean },
  event: { hostId: string | null; createdById: string | null; coHostIds: string[] },
): AttachableWho {
  if (actor.isOrganiser) return { userIds: [], anyone: true };

  // The host's, the creator's, and every co-host's — including the person
  // asking, who is one of those three or would not have got this far.
  const userIds = [
    actor.userId,
    ...(event.hostId ? [event.hostId] : []),
    ...(event.createdById ? [event.createdById] : []),
    ...event.coHostIds,
  ];

  return { userIds: [...new Set(userIds)], anyone: false };
}

/**
 * Why a reservation cannot be attached, or null when it can.
 *
 * Each of these is a real way for an organiser to take a room that is not
 * free, so each gets a sentence rather than a silent skip.
 */
export function attachProblem(
  booking: {
    id: string;
    eventId: string | null;
    isCoopHold: boolean;
    status: string;
    userId: string;
  },
  eventId: string,
  who: AttachableWho,
): string | null {
  if (booking.eventId && booking.eventId !== eventId) {
    return 'That room is already held for another event.';
  }
  if (booking.isCoopHold) {
    return 'That is a hold the co-op made rather than somebody’s reservation. Book the room first.';
  }
  if (booking.status === 'CANCELED' || booking.status === 'REJECTED') {
    return `That reservation is ${booking.status.toLowerCase()}, so the room is not held.`;
  }
  if (!who.anyone && !who.userIds.includes(booking.userId)) {
    return 'That reservation belongs to somebody who is not running this event. Add them as a co-host first.';
  }

  return null;
}
