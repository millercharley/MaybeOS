import { readFileSync } from 'fs';
import { join } from 'path';
import type { CalendarImportSummary, ImportableCalendar } from '@/lib/api';
import {
  DEFAULT_MONTHS_BACK,
  MAX_REQUESTS,
  MONTHS_BACK_CHOICES,
  calendarNote,
  confirmationLine,
  isSelectable,
  kindLabel,
  selectableCalendars,
  mergeSummaries,
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

/**
 * A host who is not a member any more (CAL-03).
 *
 * Charley, 2026-10-02: "If a member is missing because they left the co-op,
 * just note the name of this user in the past event. If the person re-joins
 * in the future, reconnect them to their past events."
 */
describe('an imported event whose host has left', () => {
  const page = readFileSync(
    join(__dirname, '..', 'app', '(app)', 'portal', '[orgSlug]', 'events', '[eventSlug]', 'page.tsx'),
    'utf8',
  );

  it('still says who ran it', () => {
    // "A workshop, hosted by nobody" is worse than not importing it.
    expect(page).toMatch(/event\.hostName/);
  });

  it('prefers the member when there is one', () => {
    expect(page.indexOf('event.host?.name')).toBeLessThan(page.indexOf('event.hostName'));
  });

  it('offers no card and no message for somebody who is not here', () => {
    // `MemberName` opens a profile. There is no profile to open, and a dead
    // link on a past event is worse than plain text.
    const fallback = page.slice(page.indexOf('event.hostName'), page.indexOf('event.hostName') + 700);

    expect(fallback).not.toMatch(/<MemberName/);
  });
});

/**
 * An import that arrives in pieces (CAL-05).
 *
 * MaybeItsFate's first real import returned 504: nine calendars and a year of
 * entries do not fit in a Lambda's ten seconds, and when it ran out the whole
 * run was lost — along with any way of telling whether it had got nowhere or
 * nearly all the way. The run now stops before the clock does and says where
 * it got to; the screen keeps asking and adds up what it is told.
 */
describe('adding up the chunks', () => {
  const chunk = (over: Partial<CalendarImportSummary> = {}): CalendarImportSummary => ({
    calendars: [],
    events: 0,
    bookings: 0,
    skipped: 0,
    dryRun: false,
    next: null,
    ...over,
  });

  it('is the first chunk when there is nothing yet', () => {
    const first = chunk({ events: 120 });

    expect(mergeSummaries(null, first)).toBe(first);
  });

  it('adds the totals', () => {
    const merged = mergeSummaries(
      chunk({ events: 120, bookings: 4, skipped: 2, failed: 1 }),
      chunk({ events: 95, bookings: 7, skipped: 1, failed: 2 }),
    );

    expect(merged).toMatchObject({ events: 215, bookings: 11, skipped: 3, failed: 3 });
  });

  it('adds what each calendar wrote', () => {
    const row = (written: number) => ({ id: 'cal-1', name: 'Events', kind: 'events' as const, found: 420, written });
    const merged = mergeSummaries(chunk({ calendars: [row(150)] }), chunk({ calendars: [row(140)] }));

    expect(merged.calendars).toHaveLength(1);
    expect(merged.calendars[0].written).toBe(290);
  });

  it('adds up the entries each page held', () => {
    // A chunk reads one page rather than the whole calendar (CAL-06), so
    // `found` is this page's entries and the total is the sum.
    const row = { id: 'cal-1', name: 'Events', kind: 'events' as const, found: 250, written: 250 };
    const merged = mergeSummaries(chunk({ calendars: [row] }), chunk({ calendars: [row] }));

    expect(merged.calendars[0].found).toBe(500);
  });

  it('keeps a calendar the later chunk never touched', () => {
    const events = { id: 'cal-1', name: 'Events', kind: 'events' as const, found: 420, written: 420 };
    const attic = { id: 'cal-2', name: 'Attic', kind: 'room' as const, found: 30, written: 30 };
    const merged = mergeSummaries(chunk({ calendars: [events] }), chunk({ calendars: [attic] }));

    expect(merged.calendars.map((c) => c.id)).toEqual(['cal-1', 'cal-2']);
  });

  it('carries the newest cursor, which is what the loop reads', () => {
    expect(mergeSummaries(chunk(), chunk({ next: { calendar: 2, entry: 40 } })).next).toEqual({
      calendar: 2,
      entry: 40,
    });
    expect(mergeSummaries(chunk({ next: { calendar: 1, entry: 0 } }), chunk()).next).toBeNull();
  });
});

describe('the screen keeps asking until it is done', () => {
  const component = readFileSync(
    join(__dirname, '..', 'components', 'settings', 'calendar-import.tsx'),
    'utf8',
  );

  it('sends the cursor back', () => {
    expect(component).toMatch(/resumeFrom/);
  });

  it('stops when there is no cursor', () => {
    expect(component).toMatch(/if \(!chunk\.next\) return;/);
  });

  it('shows the running total rather than only the last reply', () => {
    expect(component).toMatch(/total = mergeSummaries\(total, chunk\)/);
    expect(component).toMatch(/setResult\(total\)/);
  });

  it('cannot ask forever', () => {
    // A server answering with the same cursor every time would otherwise
    // keep a browser in a loop with no way out.
    expect(component).toMatch(/MAX_REQUESTS/);
    expect(MAX_REQUESTS).toBeGreaterThan(1);
    expect(MAX_REQUESTS).toBeLessThan(200);
  });

  it('says what survived when a chunk fails part way', () => {
    // Everything written stays written, and a re-run is an upsert, so the
    // honest instruction is to press it again.
    expect(component).toMatch(/Press Import again to carry on/);
  });
});

/**
 * Why it stopped in the same place twice (CAL-06).
 *
 * Charley ran the import twice and both runs ended at the same 274 Attic
 * reservations. Two causes, and each alone would have been enough.
 *
 * Every chunk re-read the whole calendar from Google before slicing its share
 * out — roughly six round trips for Attic's 1,365 entries, paid again on
 * every chunk — so almost all of the request budget went on re-reading. And
 * pressing Import again started from the first calendar rather than from
 * where the last run stopped, which is what made it stop in the *same* place
 * rather than a later one.
 */
describe('picking up where it stopped', () => {
  const component = readFileSync(
    join(__dirname, '..', 'components', 'settings', 'calendar-import.tsx'),
    'utf8',
  );

  it('remembers where the last run stopped', () => {
    expect(component).toMatch(/setStoppedAt\(chunk\.next \?\? null\)/);
  });

  it('starts the next press from there, not from the first calendar', () => {
    expect(component).toMatch(/let resumeFrom = stoppedAt;/);
  });

  it('keeps what has already been counted, rather than counting it again', () => {
    expect(component).toMatch(/let total: CalendarImportSummary \| null = result;/);
  });

  it('does not call a run that is still going a failure', () => {
    // It is not an error — it is an import bigger than one press.
    expect(component).toMatch(/Still going/);
  });
});
