import { stripComments } from './helpers/source-scan';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Co-hosts on a room reservation (SPC-37).
 *
 * Charley: "As a member, I want to add a co-host to a room reservation."
 *
 * An event has had co-hosts since EVT-32 and the reservation holding its room
 * has not, so the member who books the Attic every Tuesday was the only person
 * who could move it and the only person it appeared to.
 */
const strip = (s: string) => stripComments(s);

const panel = strip(
  readFileSync(join(__dirname, '..', 'components', 'rooms', 'booking-co-hosts.tsx'), 'utf8'),
);
const page = strip(
  readFileSync(
    join(__dirname, '..', 'app', '(app)', '(dashboard)', 'member', '[orgSlug]', 'bookings', 'page.tsx'),
    'utf8',
  ),
);
const api = strip(readFileSync(join(__dirname, '..', 'lib', 'api.ts'), 'utf8'));

describe('where it appears', () => {
  it('is on the reservation row, not behind a click', () => {
    // The useful half needs no interaction: whether somebody else is on this.
    expect(page).toMatch(/<BookingCoHosts/);
    expect(page).toMatch(/booking=\{b\}/);
  });

  it('reloads the list after a change, so the row matches the truth', () => {
    expect(page).toMatch(/onChange=\{load\}/);
  });

  it('is told who is looking', () => {
    expect(page).toMatch(/viewerId=\{user\?\.id\}/);
  });
});

describe('what the owner gets', () => {
  it('can add somebody by typing their name', () => {
    expect(panel).toMatch(/Add a co-host/);
    expect(panel).toMatch(/<MemberPicker/);
  });

  it('can take somebody off again', () => {
    expect(panel).toMatch(/api\.rooms\.removeCoHost/);
  });

  it('does not offer themselves or anybody already on it', () => {
    expect(panel).toMatch(/booking\.user \? \[booking\.user\.id\] : \[\]/);
    expect(panel).toMatch(/coHosts\.map\(\(c\) => c\.userId\)/);
  });

  it('says what adding somebody actually lets them do', () => {
    expect(panel).toMatch(/move or cancel/);
    expect(panel).toMatch(/cannot add anybody else/);
  });
});

describe('what a co-host gets', () => {
  it('is told whose reservation it is, rather than given the controls', () => {
    /*
      A co-host may change the reservation and not decide who else is on it —
      the line events draw too. Without the sentence, a reservation they
      cannot share would look like one of their own that is quietly broken.
    */
    expect(panel).toMatch(/if \(!mine\)/);
    expect(panel).toMatch(/booked this and added you/);
  });

  it('decides that from who booked it, not from the co-host list', () => {
    expect(panel).toMatch(/booking\.user\.id === viewerId/);
  });
});

describe('what it never shows', () => {
  it('names people without their addresses', () => {
    // The rule the room calendar follows: seeing who booked the studio is the
    // point, being handed their email is not.
    expect(panel).not.toMatch(/\.email/);
    const booking = api.slice(api.indexOf('export interface Booking {'));
    expect(booking.slice(0, booking.indexOf('\n}'))).not.toMatch(/email/);
  });

  it('counts nobody — it names them', () => {
    // "with 1 other" in a list of your own reservations is a question.
    expect(panel).toMatch(/co\.user\.name/);
  });
});

describe('the client', () => {
  it('has a route to add and one to remove', () => {
    expect(api).toMatch(/bookings\/\$\{bookingId\}\/co-hosts/);
    expect(api).toMatch(/co-hosts\/\$\{userId\}/);
  });
});
