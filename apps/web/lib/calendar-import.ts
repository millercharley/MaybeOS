import type { CalendarImportSummary, ImportableCalendar } from '@/lib/api';

/**
 * The sentences a calendar import is read under (CAL-02).
 *
 * The screen is markup around these decisions. An import is the one action in
 * a migration that makes something appear in front of a whole community at
 * once, and the organizer running it is nervous about exactly that — so what
 * the numbers mean has to be said in words, and the words have to be here
 * where a spec can read them rather than inlined in JSX nobody tests.
 *
 * Two of them earn their place on their own:
 *
 *   - **Which calendars can be chosen.** A room's own calendar is
 *     reservations. The API refuses one, and a screen that only finds that out
 *     after the request has let the admin make the mistake already.
 *   - **What a dry run would write.** "42 / 310 / 0" is not an answer to "will
 *     this email three hundred people". The sentence is.
 */

/** How far back an import can be told to reach, as an admin would say it. */
export const MONTHS_BACK_CHOICES: { months: number; label: string }[] = [
  { months: 0, label: 'From today on' },
  { months: 3, label: 'Back 3 months' },
  { months: 12, label: 'Back 12 months' },
  { months: 24, label: 'Back 2 years' },
];

/**
 * Charley's default. A co-op moving across wants last year's calendar to come
 * with it — an import that started today would leave the community's own
 * record of what it has done behind in Google.
 */
export const DEFAULT_MONTHS_BACK = 12;

/** "3 rooms", "1 room" — the count and its noun, which every line below needs. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * "Attic's", "Chorus'".
 *
 * A name already ending in s takes the bare apostrophe, because "the Annexes's
 * own calendar" is the kind of sentence that makes an organizer distrust
 * everything else on the screen.
 */
function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}’` : `${name}’s`;
}

/** Whether this calendar can be chosen as the one holding events. */
export function isSelectable(calendar: ImportableCalendar): boolean {
  return calendar.room === null;
}

export function selectableCalendars(calendars: ImportableCalendar[]): ImportableCalendar[] {
  return calendars.filter(isSelectable);
}

/**
 * The line under a calendar's name saying what MaybeOS already thinks it is,
 * or null when there is nothing to say.
 */
export function calendarNote(calendar: ImportableCalendar): string | null {
  if (calendar.room) {
    return `${possessive(calendar.room)} own calendar — reservations, not events`;
  }
  if (calendar.primary) {
    return 'The connected account’s own calendar';
  }
  return null;
}

/** Which column of the preview table a calendar's entries land in. */
export function kindLabel(kind: 'events' | 'room' | 'shared'): string {
  if (kind === 'events') return 'Events members see';
  // A room pointed at the events calendar. Listed rather than dropped: an
  // admin counting eight rooms and finding seven reads that as a bug.
  if (kind === 'shared') return 'Nothing — shares the events calendar';
  return 'Room reservations';
}

/**
 * What a dry run would do, or what a finished run did.
 *
 * Both say that a second run updates rather than duplicates, because the
 * question an organizer mid-migration asks after the first run is whether they
 * are allowed to fix something and go again. They are — that is the design.
 */
export function summaryLine(summary: CalendarImportSummary): string {
  const rooms = summary.calendars.filter((c) => c.kind === 'room').length;
  const hasEventsCalendar = summary.calendars.some((c) => c.kind === 'events');

  if (summary.dryRun) {
    if (summary.calendars.length === 0) {
      return 'There is nothing to read yet. No calendar has been chosen for your events, and no room has one of its own.';
    }
    if (!hasEventsCalendar) {
      return `No events calendar is chosen, so nothing would become visible to your members. ${count(
        summary.bookings,
        'reservation',
      )} would be held across ${count(rooms, 'room')}. Nothing has been written.`;
    }
    return `Importing would make ${count(
      summary.events,
      'event',
    )} visible to your members, and hold ${count(
      summary.bookings,
      'reservation',
    )} across ${count(rooms, 'room')}. Nothing has been written yet.`;
  }

  return `Imported ${count(
    summary.events,
    'event',
  )}, visible to your members, and ${count(
    summary.bookings,
    'reservation',
  )} across ${count(rooms, 'room')}. Running this again updates them rather than adding them twice.`;
}

/**
 * The confirmation, built from the preview the admin is looking at.
 *
 * Says the number, says who sees it, and says who does not. "Visible to
 * members" and "visible on the internet" are one word apart in an organizer's
 * head and several hundred strangers apart in fact.
 */
export function confirmationLine(preview: CalendarImportSummary): string {
  const rooms = preview.calendars.filter((c) => c.kind === 'room').length;

  return `This makes ${count(
    preview.events,
    'event',
  )} visible to everyone with a membership — not to the public — and holds ${count(
    preview.bookings,
    'reservation',
  )} across ${count(
    rooms,
    'room',
  )}, which members are not invited to attend. Nobody is emailed, and running it again updates what it wrote rather than adding it twice.`;
}

/**
 * How many requests the screen will make before giving up (CAL-05).
 *
 * A co-op's whole calendar at roughly a few hundred entries a request; forty
 * is far more than MaybeItsFate needs and still a bound, so a server that
 * answered with the same cursor every time could not keep a browser asking
 * forever.
 */
export const MAX_REQUESTS = 60;

/**
 * Adding one chunk of an import to what has already run (CAL-05).
 *
 * A real import arrives in pieces now — nine calendars and a year of entries
 * do not fit in one request, which is how the first one returned 504 — so the
 * screen has to add up what it has been told so far rather than show the last
 * reply.
 */
export function mergeSummaries(
  done: CalendarImportSummary | null,
  chunk: CalendarImportSummary,
): CalendarImportSummary {
  if (!done) return chunk;

  const calendars = [...done.calendars];
  for (const row of chunk.calendars) {
    const existing = calendars.findIndex((c) => c.id === row.id && c.kind === row.kind);
    if (existing === -1) {
      calendars.push(row);
      continue;
    }
    // Both add up now (CAL-06). A chunk reads one page of a calendar rather
    // than the whole thing, so `found` is this page's entries — the total is
    // the sum, the same as `written`.
    calendars[existing] = {
      ...calendars[existing],
      found: calendars[existing].found + row.found,
      written: calendars[existing].written + row.written,
      note: row.note ?? calendars[existing].note,
    };
  }

  return {
    calendars,
    events: done.events + chunk.events,
    bookings: done.bookings + chunk.bookings,
    skipped: done.skipped + chunk.skipped,
    failed: (done.failed ?? 0) + (chunk.failed ?? 0),
    dryRun: chunk.dryRun,
    next: chunk.next ?? null,
  };
}
