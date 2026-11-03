import { stripComments } from './helpers/source-scan';
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
  stripComments(s);

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

/**
 * What the reservation already answered (SPC-21, EVT-17).
 *
 * Charley, 2026-11-03: "All data already confirmed in my room reservation
 * should sync to the new event form."
 *
 * It did not. `createFromBooking` has always carried the booking's answers
 * onto the event — but only for fields the form did not send, and the form
 * sent its own empty defaults for several of them. Visibility is the one that
 * went backwards rather than merely blank: the event form always sends it and
 * an empty one holds MEMBERS_ONLY, so a reservation the member had marked
 * PUBLIC was published to members only, on a form that never showed them
 * their earlier answer.
 */
describe('syncing the reservation into the event form', () => {
  const asked = [
    ['what it is about', /description: b\.description \?\? undefined/],
    ['who it is open to', /visibility: b\.visibility/],
    ['how many people', /capacity: b\.expectedAttendance \?\? undefined/],
    ['whether it costs', /hasCost: b\.hasCost/],
    ['what kind of gathering', /tags: b\.categories/],
    ['who it is suitable for', /maturityLevel: b\.maturityLevel/],
  ] as const;

  it.each(asked)('prefills %s', (_what, pattern) => {
    expect(bookings).toMatch(pattern);
  });

  it('reads the member\'s estimate for the capacity, not the room\'s', () => {
    // They know who they invited; the room's number is an upper bound. The
    // server prefers the same one.
    expect(bookings).toMatch(/expectedAttendance/);
    expect(bookings).not.toMatch(/capacity: b\.room/);
  });

  it('declares those columns on the Booking type, so the page can read them', () => {
    const api = strip(readFileSync(join(__dirname, '..', 'lib', 'api.ts'), 'utf8'));
    const booking = api.slice(api.indexOf('export interface Booking {'));
    const upto = booking.slice(0, booking.indexOf('\n}'));

    for (const column of [
      'description',
      'visibility',
      'expectedAttendance',
      'hasCost',
      'categories',
      'maturityLevel',
    ]) {
      expect(upto).toContain(column);
    }
  });
});

describe('what the form collects and the request used to drop', () => {
  /*
    The mirror of the block above: these were all on screen and none of them
    left the page. The gathering kinds were the sharpest — `category` was sent
    and `tags` was not, so changing the kind while publishing moved the
    singular field and left the plural one holding the reservation's, and the
    two readers of them disagreed about what the event was.
  */
  const forwarded = [
    ['the kinds', /tags: values\.tags/],
    ['whether it costs', /hasCost: values\.hasCost/],
    ['the suggested amount', /suggestedCents: values\.suggestedCents \?\? undefined/],
    ['who it is suitable for', /maturityLevel: values\.maturityLevel/],
    ['the waitlist switch', /waitlistEnabled: values\.waitlistEnabled/],
    ['the co-hosts', /coHostIds: values\.coHostIds/],
    ['where the picture is cropped', /imageFocusY: values\.imageFocusY/],
  ] as const;

  it.each(forwarded)('sends %s', (_what, pattern) => {
    expect(bookings).toMatch(pattern);
  });

  it('sends every one of them through a DTO that accepts it', () => {
    /*
      The API validates with a whitelist, so an undeclared field fails the
      whole request rather than the field — which is how adding a picture to
      an event died on "property publish should not exist". `imageFocusY` was
      declared on the client's request type and missing from the DTO for
      exactly as long as nothing sent it.
    */
    const dto = strip(
      readFileSync(
        join(__dirname, '..', '..', 'api', 'src', 'modules', 'events', 'dto', 'publish-booking-event.dto.ts'),
        'utf8',
      ),
    );

    for (const field of [
      'tags',
      'hasCost',
      'suggestedCents',
      'maturityLevel',
      'waitlistEnabled',
      'coHostIds',
      'imageFocusY',
    ]) {
      expect(dto).toMatch(new RegExp(`\\b${field}\\?:`));
    }
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
