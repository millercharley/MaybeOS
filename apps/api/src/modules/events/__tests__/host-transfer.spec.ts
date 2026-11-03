import { groupOwnedEvents, transferProblem } from '../host-transfer';

/**
 * Handing over 769 events (EVT-47).
 *
 * Charley: "I have a lot of events in MaybeItsFate that are still owned by me
 * (c@maybeitsfate.com) that I want to remove from My Events and make sure the
 * real member who manages the event see all of this recurring event listed
 * under their My Events to manage."
 */

const NOW = new Date('2026-11-03T12:00:00Z');

const event = (over: Partial<Parameters<typeof groupOwnedEvents>[0][number]> = {}) => ({
  id: 'evt-1',
  title: 'Board Games Club',
  hostId: 'charley',
  startTime: new Date('2026-11-10T19:00:00Z'),
  endTime: new Date('2026-11-10T22:00:00Z'),
  payout: null,
  ...over,
});

describe('why an event cannot be handed over', () => {
  it('lets an ordinary one go', () => {
    expect(transferProblem(event(), 'the-member')).toBeNull();
  });

  it('refuses when they already host it', () => {
    expect(transferProblem(event({ hostId: 'the-member' }), 'the-member')).toMatch(
      /already host/,
    );
  });

  it('refuses when ticket money has been counted against a name', () => {
    /*
      `HostPayout.hostUserId` is who the co-op owes. The co-op pays these by
      hand from that record, so moving the host would leave money recorded
      against one member for an event the product says somebody else ran.
    */
    const problem = transferProblem(
      event({ payout: { hostUserId: 'charley' } }),
      'the-member',
    );

    expect(problem).toMatch(/Ticket money/);
    expect(problem).toMatch(/on its own/);
  });

  it('refuses a payout even when nobody is named on it', () => {
    // A payout row with a null recipient still says tickets were counted.
    expect(transferProblem(event({ payout: { hostUserId: null } }), 'the-member')).toMatch(
      /Ticket money/,
    );
  });
});

describe('grouping them into things the co-op runs', () => {
  it('puts every date of one series on one row', () => {
    const groups = groupOwnedEvents(
      [
        event({ id: 'a', startTime: new Date('2025-01-27T19:00:00Z'), endTime: new Date('2025-01-27T22:00:00Z') }),
        event({ id: 'b' }),
        event({ id: 'c', startTime: new Date('2028-10-29T19:00:00Z'), endTime: new Date('2028-10-29T22:00:00Z') }),
      ],
      NOW,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      title: 'Board Games Club',
      total: 3,
      upcoming: 2,
      eventIds: ['a', 'b', 'c'],
    });
  });

  it('spans the series, so a 2025 one is not mistaken for a live one', () => {
    const groups = groupOwnedEvents(
      [
        event({ id: 'b' }),
        event({ id: 'a', startTime: new Date('2025-01-27T19:00:00Z'), endTime: new Date('2025-01-27T22:00:00Z') }),
      ],
      NOW,
    );

    expect(groups[0].firstStart).toEqual(new Date('2025-01-27T19:00:00Z'));
    expect(groups[0].lastStart).toEqual(new Date('2026-11-10T19:00:00Z'));
  });

  it('counts an evening in progress as still to come', () => {
    // Started an hour ago, ends in two. Dropping it off the list at the
    // moment it begins is the opposite of useful (SPC-23 says the same).
    const groups = groupOwnedEvents(
      [
        event({
          startTime: new Date('2026-11-03T11:00:00Z'),
          endTime: new Date('2026-11-03T14:00:00Z'),
        }),
      ],
      NOW,
    );

    expect(groups[0].upcoming).toBe(1);
  });

  it('keeps separate titles apart', () => {
    const groups = groupOwnedEvents(
      [event({ id: 'a' }), event({ id: 'b', title: 'Improv Club' })],
      NOW,
    );

    expect(groups.map((g) => g.title).sort()).toEqual(['Board Games Club', 'Improv Club']);
  });

  it('puts the series with evenings ahead of it first', () => {
    const past = new Date('2025-06-01T19:00:00Z');
    const groups = groupOwnedEvents(
      [
        // Bigger, and entirely over.
        event({ id: 'a', title: 'Power (of attorney) Hours!', startTime: past, endTime: past }),
        event({ id: 'b', title: 'Power (of attorney) Hours!', startTime: past, endTime: past }),
        event({ id: 'c', title: 'Power (of attorney) Hours!', startTime: past, endTime: past }),
        // Smaller, and still running — where getting the host right matters.
        event({ id: 'd', title: 'Improv Club' }),
      ],
      NOW,
    );

    expect(groups[0].title).toBe('Improv Club');
  });

  it('breaks a tie by size, then by name, so the order never wobbles', () => {
    const groups = groupOwnedEvents(
      [
        event({ id: 'a', title: 'Zebra' }),
        event({ id: 'b', title: 'Apple' }),
        event({ id: 'c', title: 'Middle' }),
        event({ id: 'd', title: 'Middle' }),
      ],
      NOW,
    );

    expect(groups.map((g) => g.title)).toEqual(['Middle', 'Apple', 'Zebra']);
  });

  it('names the ones that will be refused, beside the ones that will not', () => {
    // The point of a preview: the reason a payout blocks one evening of a
    // weekly series is worth seeing beside the other dates.
    const groups = groupOwnedEvents(
      [event({ id: 'a' }), event({ id: 'b', payout: { hostUserId: 'charley' } })],
      NOW,
    );

    expect(groups[0].total).toBe(2);
    expect(groups[0].blocked).toEqual([
      { id: 'b', reason: expect.stringMatching(/Ticket money/) },
    ]);
  });

  it('says nothing is blocked when nothing is', () => {
    expect(groupOwnedEvents([event()], NOW)[0].blocked).toEqual([]);
  });

  it('has nothing to group when there is nothing', () => {
    expect(groupOwnedEvents([], NOW)).toEqual([]);
  });
});
