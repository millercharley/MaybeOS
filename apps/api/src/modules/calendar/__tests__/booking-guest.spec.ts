import { guestFrom } from '../booking-guest';

/**
 * Who a room was actually booked for (SPC-25).
 *
 * MaybeItsFate's room calendar is kept by its booking automation, so every
 * entry has the same creator. The import read that creator and handed one
 * person 3,017 reservations; marking them all as the co-op's then left the
 * real bookers with nothing, and Charley with an empty My Bookings while his
 * own reservations sat on the calendar.
 *
 * The answer was in the entry all along — 2,348 of the 3,017 name the person
 * in the description, 216 different people.
 */

const REAL = `Event • 3rd Floor Attic

Location • 1425 Story Ave

Guest • Abby Ferree (abby.m.ferree@gmail.com)

Event Title
Rehearsal`;

describe('reading the booker out of a description', () => {
  it('reads MaybeItsFate’s own format', () => {
    expect(guestFrom(REAL)).toEqual({ email: 'abby.m.ferree@gmail.com', name: 'Abby Ferree' });
  });

  it('lowercases the address, because that is what it is matched on', () => {
    expect(guestFrom('Guest • Sam (Sam@Example.COM)')?.email).toBe('sam@example.com');
  });

  it('reads the labels other booking tools use', () => {
    for (const label of ['Booked by', 'Booked for', 'Reserved by', 'Host']) {
      expect(guestFrom(`${label}: Dee Carter <dee@example.com>`)).toEqual({
        email: 'dee@example.com',
        name: 'Dee Carter',
      });
    }
  });

  it('takes the address with no name when the line has none', () => {
    expect(guestFrom('Guest • sam@example.com')).toEqual({ email: 'sam@example.com', name: null });
  });

  it('ignores an address that is not on a line about who booked it', () => {
    // A room calendar's template often carries the co-op's own contact
    // address, and attributing every booking to the front desk would be the
    // same mistake in a different hat.
    expect(
      guestFrom('Any questions? Write to hello@maybeitsfate.com\n\nEvent Title\nRehearsal'),
    ).toBeNull();
  });

  it('prefers the line that says whose it is over one that does not', () => {
    const text = 'Contact hello@maybeitsfate.com\nGuest • Abby Ferree (abby@example.com)';

    expect(guestFrom(text)?.email).toBe('abby@example.com');
  });

  it('has nothing to say about an empty description', () => {
    expect(guestFrom('')).toBeNull();
    expect(guestFrom(null)).toBeNull();
    expect(guestFrom(undefined)).toBeNull();
    expect(guestFrom('   \n  ')).toBeNull();
  });

  it('has nothing to say about a hold with no description at all', () => {
    // "HOLD for Andrea Parr" is a real entry on MaybeItsFate's calendar: a
    // name in the title and nothing else. A guess from a title would be a
    // guess, and these stay the co-op's.
    expect(guestFrom('')).toBeNull();
  });

  it('does not take a trailing full stop into the address', () => {
    expect(guestFrom('Guest • Sam (sam@example.com).')?.email).toBe('sam@example.com');
  });
});
