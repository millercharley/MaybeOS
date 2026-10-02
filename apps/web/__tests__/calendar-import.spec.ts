import { readFileSync } from 'fs';
import { join } from 'path';
import type { CalendarImportSummary, ImportableCalendar } from '@/lib/api';
import {
  DEFAULT_MONTHS_BACK,
  MONTHS_BACK_CHOICES,
  calendarNote,
  confirmationLine,
  isSelectable,
  kindLabel,
  selectableCalendars,
  summaryLine,
} from '@/lib/calendar-import';

/**
 * What the calendar import screen tells an organizer (CAL-02).
 *
 * The import is the one step of a migration that puts something in front of a
 * whole community at once, and the person running it is nervous about exactly
 * that. Two things therefore have to hold, and neither is visible in a passing
 * build: a room's own calendar must be unpickable as the events calendar, and
 * the sentence above the Import button must say who will see what.
 */

const calendar = (over: Partial<ImportableCalendar> = {}): ImportableCalendar => ({
  id: 'cal-1',
  name: 'MaybeItsFate Main Events',
  primary: false,
  room: null,
  selected: false,
  ...over,
});

const summary = (over: Partial<CalendarImportSummary> = {}): CalendarImportSummary => ({
  calendars: [],
  events: 0,
  bookings: 0,
  skipped: 0,
  dryRun: true,
  ...over,
});

const eightRooms: CalendarImportSummary['calendars'] = [
  { id: 'cal-events', name: 'Events', kind: 'events', found: 42, written: 0 },
  ...['Attic', 'Annex', 'Studio B', 'Kiln', 'Darkroom', 'Chorus', 'Woodshop', 'Loft'].map(
    (name) => ({ id: `cal-${name.toLowerCase()}`, name, kind: 'room' as const, found: 30, written: 0 }),
  ),
];

describe('which calendar can be the events calendar', () => {
  it('refuses a room’s own calendar', () => {
    // The API refuses it too, with a readable message. Finding out here means
    // the admin never makes the request that would have taught them.
    expect(isSelectable(calendar({ room: 'Attic' }))).toBe(false);
    expect(isSelectable(calendar())).toBe(true);
  });

  it('keeps only the ones an admin could pick', () => {
    const list = [calendar(), calendar({ id: 'cal-2', name: 'Attic', room: 'Attic' })];

    expect(selectableCalendars(list).map((c) => c.id)).toEqual(['cal-1']);
  });

  it('says whose calendar a room’s is, and that it is reservations', () => {
    expect(calendarNote(calendar({ room: 'Attic' }))).toBe(
      'Attic’s own calendar — reservations, not events',
    );
  });

  it('does not write "Chorus’s"', () => {
    // A possessive that reads wrong on the one screen an organizer is already
    // nervous about costs trust in every other number here.
    expect(calendarNote(calendar({ room: 'Chorus' }))).toBe(
      'Chorus’ own calendar — reservations, not events',
    );
  });

  it('names the account’s own calendar, and says nothing about the rest', () => {
    expect(calendarNote(calendar({ primary: true }))).toMatch(/connected account/);
    expect(calendarNote(calendar())).toBeNull();
  });
});

describe('what each calendar produces', () => {
  it('distinguishes the two kinds in the admin’s words', () => {
    expect(kindLabel('events')).toBe('Events members see');
    expect(kindLabel('room')).toBe('Room reservations');
  });
});

describe('what a preview says would happen', () => {
  it('states the events count, the reservations and that nothing is written', () => {
    const line = summaryLine(summary({ calendars: eightRooms, events: 42, bookings: 240 }));

    expect(line).toContain('42 events');
    expect(line).toContain('240 reservations');
    expect(line).toContain('8 rooms');
    expect(line).toMatch(/[Nn]othing has been written/);
  });

  it('says plainly that no events would appear when no events calendar is chosen', () => {
    // "0 events" buried in a sentence about 240 reservations is how somebody
    // runs the import, sees nothing on the events page and concludes it broke.
    const line = summaryLine(
      summary({ calendars: eightRooms.slice(1), events: 0, bookings: 240 }),
    );

    expect(line).toMatch(/No events calendar is chosen/);
    expect(line).toMatch(/nothing would become visible to your members/);
  });

  it('says there is nothing to read rather than importing nothing', () => {
    expect(summaryLine(summary())).toMatch(/nothing to read yet/);
  });

  it('counts one of a thing as one', () => {
    const line = summaryLine(
      summary({
        calendars: [
          { id: 'cal-events', name: 'Events', kind: 'events', found: 1, written: 0 },
          { id: 'cal-attic', name: 'Attic', kind: 'room', found: 1, written: 0 },
        ],
        events: 1,
        bookings: 1,
      }),
    );

    expect(line).toContain('1 event ');
    expect(line).toContain('1 reservation ');
    expect(line).toContain('1 room');
  });
});

describe('what a finished import reports', () => {
  it('says what was written, who sees it, and that a re-run updates', () => {
    const line = summaryLine(
      summary({
        dryRun: false,
        calendars: [{ id: 'cal-events', name: 'Events', kind: 'events', found: 42, written: 42 }],
        events: 42,
        bookings: 0,
      }),
    );

    expect(line).toContain('Imported 42 events');
    expect(line).toMatch(/visible to your members/);
    expect(line).toMatch(/updates them rather than adding them twice/);
  });
});

describe('the confirmation before the real import', () => {
  const line = confirmationLine(summary({ calendars: eightRooms, events: 42, bookings: 240 }));

  it('says how many events members will see', () => {
    expect(line).toContain('42 events');
    expect(line).toMatch(/everyone with a membership/);
  });

  it('says, in the same breath, that it is not the public', () => {
    // The distance between "visible to members" and "visible on the internet"
    // is one word in an organizer's head and several hundred strangers in fact.
    expect(line).toMatch(/not to the public/);
  });

  it('says room entries are reservations rather than things to attend', () => {
    expect(line).toContain('240 reservations');
    expect(line).toMatch(/not invited to attend/);
  });

  it('promises nobody is emailed', () => {
    // Creating an event normally announces it in the Commons (EVT-23); the
    // import writes rows directly, and this is the only place that says so.
    expect(line).toMatch(/Nobody is emailed/);
  });
});

describe('how far back an import reaches', () => {
  it('offers 12 months as the default Charley chose', () => {
    expect(DEFAULT_MONTHS_BACK).toBe(12);
    expect(MONTHS_BACK_CHOICES.map((c) => c.months)).toEqual([0, 3, 12, 24]);
    expect(MONTHS_BACK_CHOICES.some((c) => c.months === DEFAULT_MONTHS_BACK)).toBe(true);
  });
});

describe('the screen is wired to something', () => {
  const WEB_ROOT = join(__dirname, '..');

  it('is mounted on the admin settings page', () => {
    // Nothing fails if it is not. A co-op simply migrates by hand, or asks why
    // MaybeOS cannot read the calendars it has been running on for years.
    const page = readFileSync(
      join(WEB_ROOT, 'app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'settings', 'page.tsx'),
      'utf8',
    );

    expect(page).toMatch(/<CalendarImport\b/);
    expect(page).toMatch(/from '@\/components\/settings\/calendar-import'/);
  });

  it('asks for a dry run before it asks for anything else', () => {
    // `dryRun` defaults to true in the API, so a forgotten flag previews
    // rather than writes — but the screen must still offer the preview first,
    // which is the habit the sign-in link send established.
    const component = readFileSync(
      join(WEB_ROOT, 'components', 'settings', 'calendar-import.tsx'),
      'utf8',
    );

    expect(component.indexOf('dryRun: true')).toBeLessThan(component.indexOf('dryRun: false'));
    expect(component).toMatch(/setConfirming\(true\)/);
  });
});
