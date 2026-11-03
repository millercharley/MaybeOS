import { canRemoveEvent, removalProblem } from '../event-removal';

/**
 * Hiding or destroying an event (EVT-50).
 *
 * Charley: "Allow for the deletion (or hiding if that's safer) by the admin or
 * owner of future events that have an RSVP. This is not the same for sold
 * tickets to future events: those can't be deleted or hidden until all tickets
 * have been refunded."
 */

describe('what stops an event being removed', () => {
  it('lets a clean event go', () => {
    expect(removalProblem({ unrefundedTickets: 0 }, 'delete')).toBeNull();
    expect(removalProblem({ unrefundedTickets: 0 }, 'hide')).toBeNull();
  });

  it('refuses while somebody is out of pocket', () => {
    expect(removalProblem({ unrefundedTickets: 3 }, 'delete')).toMatch(/3 tickets have/);
  });

  it('refuses hiding on the same grounds, which it never used to', () => {
    /*
      Hiding was refused nothing at all, so an event somebody had paid for
      could be taken off the members' list with their money still in the
      co-op's account and the page they would look at it on simply gone.
    */
    expect(removalProblem({ unrefundedTickets: 1 }, 'hide')).toMatch(/cannot be hidden/);
  });

  it('names the action, so the sentence fits the button that was pressed', () => {
    expect(removalProblem({ unrefundedTickets: 1 }, 'delete')).toMatch(/cannot be deleted/);
    expect(removalProblem({ unrefundedTickets: 1 }, 'hide')).toMatch(/cannot be hidden/);
  });

  it('counts one ticket in the singular', () => {
    expect(removalProblem({ unrefundedTickets: 1 }, 'delete')).toMatch(/1 ticket has/);
  });

  it('says what to do next, because a refusal with no way out is a dead end', () => {
    const problem = removalProblem({ unrefundedTickets: 2 }, 'delete');

    expect(problem).toMatch(/Cancel it to refund everybody/);
    expect(problem).toMatch(/refund the tickets one at a time/);
  });

  it('stops caring once the money is back', () => {
    // The old rule counted every ticket row ever written, so an event
    // cancelled and fully refunded could still never be deleted — the
    // refusal outlived the reason for it.
    expect(removalProblem({ unrefundedTickets: 0 }, 'delete')).toBeNull();
  });

  it('is not confused by a negative count', () => {
    expect(removalProblem({ unrefundedTickets: -1 }, 'delete')).toBeNull();
  });
});

describe('what no longer stops it', () => {
  it('says nothing about RSVPs at all', () => {
    /*
      An RSVP used to refuse a delete outright. The commonest thing an
      organiser needs to delete is a duplicate the calendar import brought
      across twice — and the moment one member RSVPs to the wrong copy, the
      wrong copy was permanent. Cancelling it instead leaves a cancelled
      event on the calendar saying an evening was called off that is in fact
      happening, in the other row.
    */
    const rule = removalProblem.toString();

    expect(rule).not.toMatch(/rsvp/i);
    expect(rule).not.toMatch(/expecting/i);
  });
});

describe('who may remove one', () => {
  const event = { hostId: 'the-host', createdById: 'the-creator' };

  it('lets an organiser', () => {
    expect(canRemoveEvent(event, 'anybody', true)).toBe(true);
  });

  it('lets the host, which is the "owner" in the ask', () => {
    expect(canRemoveEvent(event, 'the-host', false)).toBe(true);
  });

  it('lets whoever created it, after handing it on', () => {
    // An organiser making an event on a member's behalf would otherwise lose
    // the ability to clear up their own mistake the moment they set the host.
    expect(canRemoveEvent(event, 'the-creator', false)).toBe(true);
  });

  it('refuses an ordinary member', () => {
    expect(canRemoveEvent(event, 'somebody-else', false)).toBe(false);
  });

  it('is the same rule as deciding who runs it, and narrower than editing', () => {
    // A co-host may change every detail of an event; that is deliberately
    // wider than this. Being asked to help run an evening is not being handed
    // the power to make it never have existed.
    expect(canRemoveEvent({ hostId: null, createdById: null }, 'a-co-host', false)).toBe(
      false,
    );
  });
});
