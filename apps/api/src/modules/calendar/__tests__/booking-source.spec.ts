import { readSource } from '../../../common/testing/source-scan';
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
// Comments blanked, line breaks kept: both files now explain this at
// length, and a scan matching prose proves nothing.
const read = (...p: string[]) => readSource(__dirname, '..', ...p);

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
    // `byPerson` since SPC-38, which is `byGuestName ?? byTitle` — the same
    // kind of evidence from one more place. The `!ours &&` this test exists
    // for is untouched.
    expect(IMPORT).toMatch(/\.\.\.\(!ours && byPerson && byPerson !== fallback\.userId/);
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

/**
 * …and a row the importer created is not one of ours (SPC-39).
 *
 * SPC-36 above added the column with `DEFAULT 'MAYBEOS'` and no backfill, so
 * every row that already existed — the thousands the importer had created
 * among them — began claiming to be a MaybeOS booking. The guard this file
 * exists to pin is absolute: `ours` means the import does not look at
 * ownership at all. So a reservation it had filed under the wrong person was
 * frozen under them, and every later pass, including the ones that learned
 * to read a guest line, a title and a guest's name, declined to correct it.
 *
 * Eight of MaybeItsFate's sat in the first organiser's My Bookings — he is
 * the fallback owner, which is who an unmatched reservation is filed under —
 * six of them upcoming evenings in the Attic that another member had booked
 * through the co-op's old calendar tool.
 *
 * The fix is the data, not the guard: the migration hands those rows back by
 * recognising the one thing MaybeOS never writes into a description, which
 * is the very line `booking-guest.ts` reads to find out whose reservation it
 * is. These tests keep the two statements of that line from drifting apart.
 */
describe('the backfill SPC-36 did not write', () => {
  const MIGRATION = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'prisma',
      'migrations',
      '20261121200000_spc39_imported_booking_source',
      'migration.sql',
    ),
    'utf8',
  );

  const GUEST = read('booking-guest.ts');

  /** The labels the SQL looks for, out of its own alternation. */
  const sqlLabels = (MIGRATION.match(/\(guest\|[^)]*\)/) ?? [''])[0]
    .replace(/^\(|\)$/g, '')
    .split('|')
    .filter(Boolean);

  /** The labels `guestFrom` looks for, out of its own array. */
  const codeLabels = (GUEST.match(/const LABELS = \[([^\]]*)\]/) ?? ['', ''])[1]
    .split(',')
    .map((part) => part.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);

  it('moves the rows, and only in one direction', () => {
    expect(MIGRATION).toMatch(/UPDATE "bookings"\s*\nSET "source" = 'GOOGLE'/);
    expect(MIGRATION).toMatch(/WHERE "source" = 'MAYBEOS'/);
  });

  it('leaves ownership to the import rather than writing it here', () => {
    /*
      SPC-35 is what makes that safe: a pass with weaker evidence may no
      longer take a reservation off a member it is already attributed to, so
      the 42 of these that are already on the right person stay there while
      the 8 that are not get looked at again.
    */
    expect(MIGRATION).not.toMatch(/"userId"\s*=/);
    expect(MIGRATION).not.toMatch(/"isCoopHold"\s*=/);
    expect(MIGRATION).not.toMatch(/"bookedFor/);
  });

  it('recognises a row by the line only a booking tool writes', () => {
    expect(codeLabels.length).toBeGreaterThan(1);
    expect(sqlLabels).toEqual(codeLabels);
  });

  it('spells the word boundary the way Postgres does', () => {
    // `\b` is a backspace in a Postgres regex, so it would match nothing and
    // the migration would silently move no rows at all.
    expect(MIGRATION).toContain(')\\M');
    expect(MIGRATION).not.toMatch(/\)\\b/);
  });

  it('asks for a calendar entry, since that is what it is claiming', () => {
    expect(MIGRATION).toMatch(/"googleEventId" IS NOT NULL/);
  });
});
