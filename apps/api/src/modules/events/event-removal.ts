/**
 * Taking an event away — hiding it, or destroying it (EVT-50).
 *
 * Charley: "Allow for the deletion (or hiding if that's safer) by the admin or
 * owner of future events that have an RSVP. This is not the same for sold
 * tickets to future events: those can't be deleted or hidden until all tickets
 * have been refunded."
 *
 * Both halves of that are changes, in opposite directions.
 *
 * **An RSVP no longer stops anything.** It used to: a delete was refused with
 * "N members are expecting this event… Cancel it instead". That is good
 * advice and it was a bad rule, because the commonest thing an organiser
 * needs to delete is a duplicate the calendar import brought across twice —
 * and the moment one member RSVPs to the wrong copy, the wrong copy becomes
 * permanent. Cancelling it leaves a cancelled event on the co-op's calendar
 * saying an evening was called off that is in fact happening, in the other
 * row.
 *
 * **A sold ticket stops both.** It used to stop only deletion, and hiding was
 * refused nothing at all — so an event somebody had paid for could be taken
 * off the members' list with their money still in the co-op's account, and
 * the page they would go to look at it on simply gone. Money is the line:
 * refund first, and then the event is yours to remove.
 *
 * **Refunded tickets do not count.** The old rule counted every ticket row
 * ever written, so an event cancelled and fully refunded could still never be
 * deleted — the refusal outlived the reason for it. What matters is whether
 * anybody is out of pocket.
 */

export interface RemovalCounts {
  /** Tickets sold and not yet refunded. Seats, not purchases. */
  unrefundedTickets: number;
}

/**
 * Why an event cannot be hidden or deleted, or null when it can.
 *
 * One sentence that says the number and what to do about it: "cannot delete"
 * with no number is a dead end, and the organiser's next step is a refund.
 */
export function removalProblem(
  counts: RemovalCounts,
  action: 'delete' | 'hide',
): string | null {
  const { unrefundedTickets } = counts;
  if (unrefundedTickets <= 0) return null;

  const seats =
    unrefundedTickets === 1 ? '1 ticket has' : `${unrefundedTickets} tickets have`;

  return (
    `${seats} been sold for this event and not refunded, so it cannot be ` +
    `${action === 'delete' ? 'deleted' : 'hidden'}. Cancel it to refund everybody, ` +
    'or refund the tickets one at a time, and then it can be removed.'
  );
}

/**
 * Whether this person may hide or delete it.
 *
 * The same three people who may decide who runs it: an organiser, the host,
 * or whoever created it. Charley's words are "the admin or owner", and the
 * creator is in because an organiser making an event on a member's behalf
 * would otherwise lose the ability to clear up their own mistake the moment
 * they set the host.
 *
 * **A co-host may not**, which is the one line worth stating. They can change
 * every detail of an event (`canEditEvent`), and that is deliberately wider
 * than this: being asked to help run an evening is not being handed the power
 * to make it never have existed.
 */
export { canManageHosts as canRemoveEvent } from './host-control';

export const NOT_YOURS_TO_REMOVE =
  'Only an organiser, the host, or whoever created this event can remove it.';
