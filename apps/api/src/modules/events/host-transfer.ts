/**
 * Handing somebody else's events over in bulk (EVT-47).
 *
 * Charley: "As an admin, I want to transfer events to a new owner. From the
 * calendar migration, I have a lot of events in MaybeItsFate that are still
 * owned by me (c@maybeitsfate.com) that I want to remove from My Events and
 * make sure the real member who manages the event see all of this recurring
 * event listed under their My Events to manage."
 *
 * 769 of them, 183 still to come. They are his because the calendar import
 * creates what it finds under the account whose calendar it read — the same
 * reason 3,017 room reservations arrived as his (SPC-23) — and `setHost`
 * moves exactly one event at a time. Forty-six Board Games Clubs is forty-six
 * trips through a member picker.
 *
 * **Nothing here can guess who the real host is.** CAL-03 carries the Google
 * organiser's name and address onto an imported event precisely so that a
 * member who rejoins finds the evenings they ran — and on every one of these
 * 769 `hostEmail` is null, because the series were created rather than
 * imported with an organiser. So MaybeOS does not know, cannot work it out,
 * and must not appear to: the admin names the member, and what this offers is
 * the grouping that makes naming them once enough.
 *
 * **The grouping is the title.** Not `parentEventId`, which only exists for
 * series MaybeOS itself repeated, and not the Google recurrence id, which
 * 70% of these do not have. "Ecstatic Dance ~ 1st Sundays" is what the co-op
 * calls the thing one member runs, and it is what an admin is looking at when
 * they decide whose it is.
 */

/** What the rule needs to know about one event. */
export interface TransferableEvent {
  id: string;
  title: string;
  hostId: string | null;
  /** Null when no payout has ever been worked out for it. */
  payout?: { hostUserId: string | null } | null;
}

/**
 * Why an event cannot be handed over, or null when it can.
 *
 * One sentence each rather than a silent skip, because a bulk action that
 * quietly leaves things out is a bulk action nobody can check.
 */
export function transferProblem(
  event: TransferableEvent,
  toUserId: string,
): string | null {
  if (event.hostId === toUserId) {
    return 'They already host this one.';
  }

  /*
    Money has been counted against a name (EVT-15).

    `HostPayout.hostUserId` is who the co-op owes for the tickets this event
    sold. Moving the host afterwards would leave a payout recorded against
    one member for an event the product now says somebody else ran — and the
    co-op pays these by hand, from this record. Whoever is sorting that out
    needs to do it deliberately, on the event, not as one row of 46.
  */
  if (event.payout) {
    return 'Ticket money has already been counted for this one, so who is owed it would stop matching who ran it. Change this event on its own.';
  }

  return null;
}

export interface OwnedGroup {
  title: string;
  total: number;
  upcoming: number;
  /** So an admin can tell this year's series from one that ended in 2025. */
  firstStart: Date;
  lastStart: Date;
  /** Every id in the group, so the transfer names events rather than a title. */
  eventIds: string[];
  /** The ones that would be refused, with the reason, before anything is sent. */
  blocked: { id: string; reason: string }[];
}

/**
 * One row per thing the co-op runs, rather than 769 rows of dates.
 *
 * Sorted by what is still to come and then by size: the series with evenings
 * ahead of it is the one where getting the host right still changes
 * something, and a member who cannot edit next Tuesday's event is the
 * complaint this exists to answer.
 */
export function groupOwnedEvents(
  events: (TransferableEvent & { startTime: Date; endTime: Date })[],
  now: Date = new Date(),
): OwnedGroup[] {
  const groups = new Map<string, OwnedGroup>();

  for (const event of events) {
    const existing = groups.get(event.title);
    const group: OwnedGroup = existing ?? {
      title: event.title,
      total: 0,
      upcoming: 0,
      firstStart: event.startTime,
      lastStart: event.startTime,
      eventIds: [],
      blocked: [],
    };

    group.total += 1;
    if (event.endTime >= now) group.upcoming += 1;
    if (event.startTime < group.firstStart) group.firstStart = event.startTime;
    if (event.startTime > group.lastStart) group.lastStart = event.startTime;
    group.eventIds.push(event.id);

    // Reported per group rather than per event: the reason a payout blocks one
    // evening of a weekly series is worth seeing beside the other 45.
    if (event.payout) {
      group.blocked.push({
        id: event.id,
        // The same sentence the transfer itself would give, so the preview and
        // the refusal cannot drift apart.
        reason: transferProblem({ ...event, hostId: null }, '') ?? 'Cannot be moved.',
      });
    }

    if (!existing) groups.set(event.title, group);
  }

  return [...groups.values()].sort(
    (a, b) => b.upcoming - a.upcoming || b.total - a.total || a.title.localeCompare(b.title),
  );
}
