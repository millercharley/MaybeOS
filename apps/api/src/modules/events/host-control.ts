/**
 * Who may decide who runs an event (EVT-32).
 *
 * Charley: "The admin needs the ability to switch the host and add co-hosts.
 * Make sure the member who created the event also has the ability."
 *
 * Three answers, and the third is the one that needs writing down. An
 * organiser can, because running the co-op's calendar is their job. The
 * current host can, because it is their event. And the **creator** can, which
 * is not implied by either: the host starts as the creator and can be handed
 * on, so without this an organiser making an event on a member's behalf —
 * which is the case `hostId` exists for — would lose the ability to correct
 * it the moment they set the host, and a member handing their workshop to a
 * colleague could not take it back.
 *
 * A co-host cannot. Being asked to help run an evening is not being given the
 * power to hand it to somebody else, or to remove the person who asked you.
 */

export interface HostControlEvent {
  hostId: string | null;
  createdById: string | null;
}

export function canManageHosts(
  event: HostControlEvent,
  userId: string,
  isOrganiser: boolean,
): boolean {
  if (isOrganiser) return true;
  if (event.hostId && event.hostId === userId) return true;

  return Boolean(event.createdById && event.createdById === userId);
}

/** Why they cannot, in words an organiser or a member can act on. */
export const NOT_YOURS =
  'Only an organiser, the host, or whoever created this event can change who runs it.';

/**
 * Whether a person may be added as a co-host.
 *
 * The host is not a co-host of their own event — the list would read "hosted
 * by Ada, with Ada" — and the same person cannot be added twice, which the
 * unique index enforces anyway but which deserves a sentence rather than a
 * constraint violation.
 */
export function coHostProblem(
  event: HostControlEvent,
  userId: string,
  existing: string[],
): string | null {
  if (event.hostId === userId) {
    return 'They are already the host of this event.';
  }
  if (existing.includes(userId)) {
    return 'They are already a co-host of this event.';
  }

  return null;
}

/**
 * Who may change an event (EVT-33).
 *
 * Charley: "Make sure any host, co-host and admin can edit the title, image,
 * and description… change any detail… add ticketing or manage the ticketing,
 * and review who has bought tickets."
 *
 * Wider than `canManageHosts` by exactly one person: a co-host. They were
 * asked to help run the evening, so they can correct a time, write the
 * description, set what a ticket costs and see who is coming — everything
 * about the event itself. What they cannot do is decide who runs it, which
 * is the line `canManageHosts` draws.
 */
export function canEditEvent(
  event: HostControlEvent & { coHostIds?: string[] },
  userId: string,
  isOrganiser: boolean,
): boolean {
  if (canManageHosts(event, userId, isOrganiser)) return true;

  return (event.coHostIds ?? []).includes(userId);
}

/** Why they cannot, in words somebody can act on. */
export const NOT_YOUR_EVENT =
  'Only an organiser, the host or a co-host can change this event.';

