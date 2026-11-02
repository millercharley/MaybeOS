import { stripComments } from '../../../common/testing/source-scan';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A MaybeOS booking is tracked by its own id (SPC-36).
 *
 * MaybeOS creates the booking, pushes it to Google, and stores the returned
 * `googleEventId` on the row. The importer matched on that same id, found
 * "an existing row", and re-derived whose booking it was from the calendar's
 * own weak signals — the title, and the address of whatever account created
 * the entry. So our own bookings were being identified by the thing that
 * exists to watch for reservations made *outside* us.
 *
 * At MaybeItsFate that had turned 175 of 231 native bookings into co-op
 * holds, 140 of them upcoming and invisible to 33 members, with 10 carrying
 * somebody else's name in `bookedFor`. Booking a room through MaybeOS and
 * then not being able to find it was the normal outcome.
 *
 * Two directions now close the loop: the row records where it came from, and
 * the Google event carries the booking id. The import keeps the secondary
 * job it was always for — noticing what somebody reserved in Google direct.
 */
const read = (...p: string[]) =>
  readFileSync(join(__dirname, '..', ...p), 'utf8')
    // Comments blanked, line breaks kept: both files now explain this at
    // length, and a scan matching prose proves stripComments(nothing.);

const IMPORT = read('calendar-import.service.ts');
const CALENDAR = read('calendar.service.ts');
const SCHEMA = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'prisma', 'schema.prisma'),
  'utf8',
);

describe('the booking id travels to Google', () => {
  it('is stamped when the event is created', () => {
    expect(CALENDAR).toMatch(
      /extendedProperties: \{\s*\n\s*private: \{ maybeosBookingId: booking\.id \},/,
    );
  });

  it('is stamped again when the event is updated', () => {
    /*
      `events.update` replaces the whole event rather than patching it, so
      leaving this out of the update body would quietly strip the id off
      every booking anybody edits — and the stamp would then be missing
      from exactly the bookings that had been touched most.
    */
    const stamps = CALENDAR.match(/maybeosBookingId: booking\.id/g) ?? [];
    expect(stamps).toHaveLength(2);
  });

  it('keeps it private rather than publishing it', () => {
    // A co-op may embed this calendar on their website.
    expect(CALENDAR).not.toMatch(/shared: \{ maybeosBookingId/);
  });
});

describe('the row records where it came from', () => {
  it('has a source with two values', () => {
    expect(SCHEMA).toMatch(/enum BookingSource \{[\s\S]*?MAYBEOS[\s\S]*?GOOGLE[\s\S]*?\}/);
  });

  it('defaults to MAYBEOS, which is the safe direction', () => {
    /*
      A row of unknown origin is treated as ours and therefore left alone,
      rather than offered up to be re-owned. Defaulting the other way would
      reintroduce the bug for anything the importer has not labelled.
    */
    expect(SCHEMA).toMatch(/source\s+BookingSource @default\(MAYBEOS\)/);
  });

  it('is set to GOOGLE only where the importer creates a row', () => {
    expect(IMPORT).toMatch(/source: 'GOOGLE',/);
    expect((IMPORT.match(/source: 'GOOGLE'/g) ?? [])).toHaveLength(1);
  });
});

describe('the importer leaves a MaybeOS booking alone', () => {
  it('asks the row where it came from', () => {
    expect(IMPORT).toMatch(/const ours = existing\?\.source === 'MAYBEOS';/);
    expect(IMPORT).toMatch(/source: true,/);
  });

  it('does not re-flag one of ours as a co-op hold', () => {
    expect(IMPORT).toMatch(
      /const isCoopHold = ours \? existing\.isCoopHold : attributed \? false : computedCoopHold;/,
    );
  });

  it('does not move the owner of one of ours', () => {
    expect(IMPORT).toMatch(/\.\.\.\(!ours && byTitle && byTitle !== fallback\.userId/);
  });

  it('does not put anybody else’s name on one of ours', () => {
    expect(IMPORT).toMatch(/const bookedFor = ours \|\| matched \|\| attributed \? mine : bookedForPerson;/);
  });

  it('still does its real job on a reservation made in Google', () => {
    /*
      The secondary need, which is the one the import was always for. All of
      this has to keep working or a co-op loses sight of everything booked
      outside MaybeOS.
    */
    expect(IMPORT).toContain('const computedCoopHold =');
    expect(IMPORT).toMatch(/matched === null \|\| \(!named && matched === fallback\.userId\)/);
    expect(IMPORT).toContain('titleNameKeys(entry.title)');
    expect(IMPORT).toMatch(/await this\.prisma\.booking\.create\(/);
  });

  it('still follows Google for the times and the title', () => {
    // Somebody dragging a booking in the calendar means it. Who it belongs
    // to is what is settled elsewhere.
    expect(IMPORT).toMatch(/title: entry\.title,\s*\n\s*startTime: entry\.start,\s*\n\s*endTime: entry\.end,/);
  });
});
