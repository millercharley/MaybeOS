import { attachProblem, whoseRoomsCount } from '../event-rooms';

/**
 * Tying rooms to events (SPC-26, SPC-27).
 *
 * Charley: "the user can only see rooms they or a co-host has reserved (ask
 * for co-host first)."
 *
 * A reservation is somebody's hold on a room. An event claiming one that
 * belongs to a member who knows nothing about it would take their room, so
 * the list an event chooses from is the people already running it.
 */

const event = { hostId: 'u-host', createdById: 'u-creator', coHostIds: ['u-helper'] };

describe('whose reservations an event may claim', () => {
  it('an organiser sees the co-op’s', () => {
    // Sorting out a double-booked evening is their job.
    expect(whoseRoomsCount({ userId: 'u-admin', isOrganiser: true }, event)).toEqual({
      userIds: [],
      anyone: true,
    });
  });

  it('a host sees their own, the creator’s and the co-hosts’', () => {
    const who = whoseRoomsCount({ userId: 'u-host', isOrganiser: false }, event);

    expect(who.anyone).toBe(false);
    expect(who.userIds).toEqual(expect.arrayContaining(['u-host', 'u-creator', 'u-helper']));
  });

  it('a co-host sees the same list', () => {
    // They were asked to help run it, and their own booking is often the one.
    expect(
      whoseRoomsCount({ userId: 'u-helper', isOrganiser: false }, event).userIds,
    ).toContain('u-helper');
  });

  it('names nobody twice', () => {
    const who = whoseRoomsCount({ userId: 'u-host', isOrganiser: false }, {
      hostId: 'u-host',
      createdById: 'u-host',
      coHostIds: ['u-host'],
    });

    expect(who.userIds).toEqual(['u-host']);
  });
});

describe('whether a reservation can be attached', () => {
  const who = { userIds: ['u-host', 'u-helper'], anyone: false };
  const booking = (over = {}) => ({
    id: 'b-1',
    eventId: null as string | null,
    isCoopHold: false,
    status: 'APPROVED',
    userId: 'u-host',
    ...over,
  });

  it('allows one the host holds and nothing else claims', () => {
    expect(attachProblem(booking(), 'e-1', who)).toBeNull();
  });

  it('allows one already attached to this same event', () => {
    // Saving the form again must not refuse the rooms it already has.
    expect(attachProblem(booking({ eventId: 'e-1' }), 'e-1', who)).toBeNull();
  });

  it('refuses one held for another event', () => {
    expect(attachProblem(booking({ eventId: 'e-2' }), 'e-1', who)).toMatch(/another event/);
  });

  it('refuses a hold the co-op made', () => {
    // Those are the calendar's, not a member's (SPC-23), and attaching one
    // would claim a room nobody booked.
    expect(attachProblem(booking({ isCoopHold: true }), 'e-1', who)).toMatch(/Book the room first/);
  });

  it('refuses one that is cancelled, because the room is not held', () => {
    expect(attachProblem(booking({ status: 'CANCELED' }), 'e-1', who)).toMatch(/not held/);
    expect(attachProblem(booking({ status: 'REJECTED' }), 'e-1', who)).toMatch(/not held/);
  });

  it('refuses somebody else’s, and says what to do about it', () => {
    expect(attachProblem(booking({ userId: 'u-stranger' }), 'e-1', who)).toMatch(
      /Add them as a co-host first/,
    );
  });

  it('lets an organiser attach anybody’s', () => {
    expect(
      attachProblem(booking({ userId: 'u-stranger' }), 'e-1', { userIds: [], anyone: true }),
    ).toBeNull();
  });
});
