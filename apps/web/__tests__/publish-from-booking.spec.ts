import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Publishing an event from a booking already knows the room (SPC-31).
 *
 * Charley: the room question "should be prefilled when the user has booked the
 * room and clicked the button to publish as an event". It was not — the picker
 * opened empty, asking the member to find their own reservation in a list that
 * for an organiser holds the whole co-op's.
 */
const strip = (s: string) =>
  s.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const bookings = strip(
  readFileSync(
    join(__dirname, '..', 'app', '(app)', '(dashboard)', 'member', '[orgSlug]', 'bookings', 'page.tsx'),
    'utf8',
  ),
);
const form = strip(readFileSync(join(__dirname, '..', 'components', 'events', 'event-form.tsx'), 'utf8'));
const picker = strip(readFileSync(join(__dirname, '..', 'components', 'events', 'room-picker.tsx'), 'utf8'));

describe('publishing from a booking', () => {
  it('hands the form the booking it is publishing', () => {
    expect(bookings).toMatch(/fixedBookingId: b\.id/);
    expect(bookings).toMatch(/rooms: \[\s*\{\s*id: b\.id/);
  });

  it('does nothing when the row has no room to offer', () => {
    // `/my-bookings` is the only list carrying `room`, and a guard beats an
    // undefined `b.room.id` in the one place it is missing.
    expect(bookings).toMatch(/\.\.\.\(b\.room\s*\n?\s*\?/);
  });

  it('sends the rooms the picker added, which the request used to drop', () => {
    expect(bookings).toMatch(/bookingIds: values\.bookingIds/);
  });
});

describe('the reservation the event is made out of', () => {
  it('is marked as fixed rather than given an × that does nothing', () => {
    /*
      The server attaches it whatever the form says — it is what calls the
      event off if the booking is cancelled. A remove button that silently
      failed would be worse than none.
    */
    expect(form).toMatch(/fixedId=\{initial\?\.fixedBookingId\}/);
    expect(picker).toMatch(/p\.id === fixedId \?/);
    expect(picker).toMatch(/held for this/);
  });

  it('is filtered out of the extra rooms on the server, not trusted from the client', () => {
    const service = readFileSync(
      join(__dirname, '..', '..', 'api', 'src', 'modules', 'events', 'events.service.ts'),
      'utf8',
    );
    expect(service).toMatch(/dto\.bookingIds \?\? \[\]\)\.filter\(\(id\) => id !== booking\.id\)/);
  });
});

describe('what the help text claims', () => {
  it('no longer tells an organiser they only see their own', () => {
    // They are shown the whole co-op's, deliberately.
    expect(form).not.toMatch(/Only bookings made by you or a/);
    expect(form).toMatch(/organisers see the whole co-op/);
  });

  it('says that finished reservations are left out', () => {
    expect(form).toMatch(/already finished are left out/);
  });
});
