/**
 * When the calendar sync should run itself (CAL-13).
 *
 * Until now an import only happened when an admin pressed the button. That is
 * how the Attic stayed booked after its Google entry was deleted: there was
 * nothing wrong with the sync by then, there was nothing running it.
 *
 * Pure, so the rules can be read and tested without a scheduler, a database or
 * Google. The service does the work; this decides what the work is.
 */

/** One co-op's sync state, as the scheduler reads it. */
export interface SyncState {
  orgId: string;
  /** Part-way through a pass. Null means no pass is in flight. */
  cursor: unknown | null;
  /** When the last pass finished, or null if one never has. */
  syncedAt: Date | null;
}

/**
 * How long between finished passes.
 *
 * Not the fifteen minutes the scheduler ticks at. A full pass is nine
 * calendars and two years of entries for MaybeItsFate, and running that four
 * times an hour would spend most of a Google quota re-reading entries nobody
 * has touched. An hour is the compromise: a deleted booking frees up within
 * the hour rather than whenever somebody next presses a button.
 */
export const SYNC_INTERVAL_MS = 60 * 60 * 1000;

/**
 * How far back a scheduled pass looks.
 *
 * A manual import reaches a year back, because it is bringing in a history
 * nobody has. This is keeping an already-imported calendar true, and changes
 * to last March are not what anybody is waiting on. A shorter window is fewer
 * pages, which is the difference between a pass finishing in a few ticks and
 * grinding through all afternoon.
 */
export const SYNC_MONTHS_BACK = 1;

/**
 * Which co-op this tick should work on.
 *
 * **One per tick, never all of them.** Each one costs Google reads and a
 * Lambda's wall clock, and a hundred co-ops in a loop would hit the limit on
 * whichever one happened to be last.
 *
 * **Anything mid-pass comes first.** A cursor is a pass already in flight, and
 * finishing it is both more useful than starting another and the only way it
 * ever finishes.
 *
 * **Then the stalest.** Oldest `syncedAt` first, with never-synced ahead of
 * everything — the same rule the door sync settled on, and for the same
 * reason: a fixed order means the same co-op is served every time and the one
 * after it never is.
 */
export function nextToSync(states: SyncState[], now: Date): SyncState | null {
  const inFlight = states.filter((state) => state.cursor != null);
  if (inFlight.length > 0) {
    return [...inFlight].sort(byStaleness)[0];
  }

  const due = states.filter(
    (state) =>
      state.syncedAt === null || now.getTime() - state.syncedAt.getTime() >= SYNC_INTERVAL_MS,
  );
  if (due.length === 0) return null;

  return [...due].sort(byStaleness)[0];
}

/** Never-synced first, then oldest first. */
function byStaleness(a: SyncState, b: SyncState): number {
  if (a.syncedAt === null && b.syncedAt === null) return a.orgId < b.orgId ? -1 : 1;
  if (a.syncedAt === null) return -1;
  if (b.syncedAt === null) return 1;
  return a.syncedAt.getTime() - b.syncedAt.getTime();
}

/**
 * What to write down after one chunk.
 *
 * `syncedAt` moves only when a pass actually finishes. Stamping it on every
 * chunk would say "synced a minute ago" through an eight-tick pass, and the
 * next interval would then start a new pass on top of the unfinished one.
 */
export function afterChunk(
  next: unknown | null,
  now: Date,
): { calendarSyncCursor: unknown | null; calendarSyncedAt?: Date; calendarSyncError: null } {
  if (next) {
    return { calendarSyncCursor: next, calendarSyncError: null };
  }
  return { calendarSyncCursor: null, calendarSyncedAt: now, calendarSyncError: null };
}

/**
 * What to write down when a chunk threw.
 *
 * The cursor is dropped, so the next pass starts from the beginning rather
 * than resuming into whatever went wrong. Imports are idempotent — an upsert
 * per entry, keyed on the Google id — so starting over costs time and nothing
 * else, while resuming past a failure would skip whatever it failed on.
 *
 * `syncedAt` is left alone: nothing finished, and moving it would hide a
 * co-op whose sync has been failing all week behind "synced recently".
 */
export function afterFailure(reason: string): {
  calendarSyncCursor: null;
  calendarSyncError: string;
} {
  return { calendarSyncCursor: null, calendarSyncError: truncate(reason, 500) };
}

function truncate(text: string, max: number): string {
  const clean = text.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}
