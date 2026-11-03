import {
  bookingCoHostProblem,
  canChangeBooking,
  canManageBookingCoHosts,
} from '../booking-co-hosts';

/**
 * Co-hosts on a room reservation (SPC-37).
 *
 * Charley: "As a member, I want to add a co-host to a room reservation."
 *
 * An event has had co-hosts since EVT-32 and the reservation holding its room
 * has not, so the member who books the Attic every Tuesday was the only person
 * who could move it and the only person it appeared to.
 */

const OWNER = 'u-owner';
const CO_HOST = 'u-cohost';
const STRANGER = 'u-stranger';

const booking = (coHostIds: string[] = [CO_HOST]) => ({ userId: OWNER, coHostIds });

describe('who may change a reservation', () => {
  it('lets whoever booked the room', () => {
    expect(canChangeBooking(booking(), OWNER, false)).toBe(true);
  });

  it('lets somebody who was added to it — the whole feature', () => {
    expect(canChangeBooking(booking(), CO_HOST, false)).toBe(true);
  });

  it('refuses anybody else', () => {
    expect(canChangeBooking(booking(), STRANGER, false)).toBe(false);
  });

  it('lets an organiser, whose job the building’s calendar is', () => {
    expect(canChangeBooking(booking(), STRANGER, true)).toBe(true);
  });

  it('refuses a stranger on a reservation nobody co-hosts', () => {
    expect(canChangeBooking(booking([]), STRANGER, false)).toBe(false);
  });
});

describe('who may decide who else is on it', () => {
  it('lets whoever booked the room', () => {
    expect(canManageBookingCoHosts(booking(), OWNER, false)).toBe(true);
  });

  it('does not let a co-host', () => {
    /*
      The line `host-control.ts` draws on an event: being asked to help run
      an evening is not being given the power to hand it to somebody else, or
      to remove the person who asked you. So the person who asked for help
      stays the person who can un-ask.
    */
    expect(canManageBookingCoHosts(booking(), CO_HOST, false)).toBe(false);
  });

  it('lets an organiser', () => {
    expect(canManageBookingCoHosts(booking(), STRANGER, true)).toBe(true);
  });

  it('is strictly narrower than who may change it', () => {
    // The two rules must not converge: a co-host who can also manage
    // co-hosts can remove the owner from their own reservation.
    expect(canChangeBooking(booking(), CO_HOST, false)).toBe(true);
    expect(canManageBookingCoHosts(booking(), CO_HOST, false)).toBe(false);
  });
});

describe('who can be added', () => {
  it('lets an ordinary member on', () => {
    expect(bookingCoHostProblem(booking([]), STRANGER)).toBeNull();
  });

  it('refuses the person whose reservation it is', () => {
    // "booked by Ada, with Ada".
    expect(bookingCoHostProblem(booking([]), OWNER)).toMatch(/already theirs/);
  });

  it('refuses somebody already on it, rather than a constraint violation', () => {
    expect(bookingCoHostProblem(booking(), CO_HOST)).toMatch(/already on this reservation/);
  });
});
