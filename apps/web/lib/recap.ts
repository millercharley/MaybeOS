import type { RecapFigures } from '@/lib/api';

/**
 * Saying what a recap's figures mean (RCP-01).
 *
 * The API is careful about three numbers it cannot state plainly — who came,
 * what the co-op took, and how far back the dues record goes — and the
 * screen can undo all of that care with one confident label. So the labels
 * are here, as functions, where a spec can read them: the organiser's page
 * is markup around these decisions and nothing else decides wording.
 *
 * Everything is formatted in the co-op's own timezone. A recap for September
 * starts at midnight on the 1st *where the co-op is*, which for anywhere east
 * of UTC is an instant in August — so formatting the stored instant in the
 * browser's zone files a month under the wrong name.
 */

/** "9am", "1pm" — the way an organizer would say it, not 09:00. */
export function hourLabel(hour: number): string {
  if (hour === 0) return 'midnight';
  if (hour === 12) return 'noon';
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

/**
 * `Intl` throws `RangeError` on a timezone it does not recognize, and a co-op
 * row carrying a zone this browser has never heard of must not take the whole
 * page down with it. UTC is wrong by hours; a blank screen is wrong entirely.
 */
function inZone(iso: string, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  const when = new Date(iso);
  try {
    return when.toLocaleDateString('en-US', { ...options, timeZone });
  } catch {
    return when.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
  }
}

/**
 * "September 2026", for a row in the list of previous recaps.
 *
 * `RecapSummary` carries only `periodStart`, so the month has to be read back
 * off the instant — which is exactly where the timezone matters.
 */
export function monthOf(periodStart: string, timeZone: string): string {
  return inZone(periodStart, timeZone, { month: 'long', year: 'numeric' });
}

/** "February 15, 2026" — a date somebody can check against their own records. */
export function dayOf(iso: string, timeZone: string): string {
  return inZone(iso, timeZone, { month: 'long', day: 'numeric', year: 'numeric' });
}

/** `MEMBER_CONNECTION` → "member connection", as the member's email writes it. */
export function categoryLabel(category: string): string {
  return category.replace(/_/g, ' ').toLowerCase();
}

export interface AttendanceLine {
  label: string;
  value: number;
  /** What this figure does and does not cover, or null when it needs no caveat. */
  caveat: string | null;
}

/**
 * Which attendance number to show, and what it is.
 *
 * Two honest answers that measure different things: a check-in is somebody
 * who was there, an RSVP is somebody who meant to be. Check-ins only exist
 * where a human worked the door, so a co-op that does not scan has a
 * truthful zero — and showing that zero as attendance says nobody came to a
 * month of full rooms.
 *
 * Null when there is nothing to say. A month with no events and no RSVPs
 * should print no attendance row rather than a zero that reads as a verdict.
 */
export function attendanceLine(events: RecapFigures['events']): AttendanceLine | null {
  if (events.checkedIn > 0) {
    return {
      label: 'People at the door',
      value: events.checkedIn,
      // Partial door coverage, said out loud. Otherwise the figure reads as
      // the month's attendance when it is the attendance of two events.
      caveat:
        events.eventsWithDoor < events.hosted
          ? `Recorded at the door of ${events.eventsWithDoor} of the ${events.hosted} events. ` +
            'The rest had nobody working one, so their attendance is not in this number.'
          : 'Recorded at the door.',
    };
  }

  if (events.expected > 0) {
    return {
      label: 'People who said they were coming',
      value: events.expected,
      caveat:
        'Confirmed RSVPs and the guests they said they were bringing. Nobody was recorded ' +
        'at a door this month, so this is who meant to come rather than who was there.',
    };
  }

  return null;
}

/** What the money figures cover, and what no figure here can cover. */
export const MONEY_SCOPE =
  'Dues, tickets and room hire taken through MaybeOS. Cash at the door, grants, ' +
  'donations and anything handled off the platform are not in it.';

/**
 * The year figure's other limit: MaybeOS has only had the dues record since
 * the co-op started paying through it.
 *
 * Compared by calendar year rather than by instant, because that is the only
 * comparison the figure itself makes — the year total runs from January 1 of
 * the recap's own year. A first dues payment in an earlier year means the
 * figure covers the whole period and needs no note.
 */
export function duesNote(figures: RecapFigures, timeZone: string): string | null {
  const since = figures.money.duesRecordedSince;
  if (!since) return null;

  const recapYear = yearOf(figures, timeZone);
  const sinceYear = Number(inZone(since, timeZone, { year: 'numeric' }));
  if (!recapYear || !sinceYear || sinceYear < recapYear) return null;

  return (
    `MaybeOS's record of dues begins ${dayOf(since, timeZone)}, so the year figure ` +
    'counts dues from then rather than from January.'
  );
}

/**
 * The calendar year the recap's month belongs to.
 *
 * From `monthLabel` first — it is the one field written in the co-op's own
 * calendar, so a January recap in a zone ahead of UTC says 2027 where its
 * stored instant still says 2026.
 */
function yearOf(figures: RecapFigures, timeZone: string): number | null {
  const labelled = figures.monthLabel.match(/\b(\d{4})\b/);
  if (labelled) return Number(labelled[1]);

  const fromInstant = Number(inZone(figures.periodStart, timeZone, { year: 'numeric' }));
  return Number.isFinite(fromInstant) ? fromInstant : null;
}
