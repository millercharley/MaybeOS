import {
  SYNC_INTERVAL_MS,
  SYNC_MONTHS_BACK,
  afterChunk,
  afterFailure,
  nextToSync,
  type SyncState,
} from '../sync-schedule';

/**
 * The calendar keeping itself true (CAL-13).
 *
 * Every other kind of staleness in MaybeOS had a scheduled task behind it and
 * the calendar had only a button, so a Google entry deleted on Monday stayed
 * booked until somebody happened to press import. The Attic is what that looks
 * like from a member's side: an evening that was free, shown as taken.
 */
const NOW = new Date('2026-10-07T18:00:00.000Z');
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 60 * 60 * 1000);

const org = (orgId: string, over: Partial<SyncState> = {}): SyncState => ({
  orgId,
  cursor: null,
  syncedAt: hoursAgo(2),
  ...over,
});

describe('choosing a co-op to sync', () => {
  it('finishes a pass already in flight before starting another', () => {
    /*
      A cursor is a pass part-way through. Starting a new one instead would
      mean the first never finishes — and an unfinished pass is one that has
      not looked at most of the calendars yet.
    */
    const chosen = nextToSync(
      [org('never-synced', { syncedAt: null }), org('mid-pass', { cursor: { calendar: 3 } })],
      NOW,
    );

    expect(chosen?.orgId).toBe('mid-pass');
  });

  it('takes the stalest when nothing is in flight', () => {
    // The rule the door sync settled on: a fixed order means the same co-op is
    // served every time and the one after it never is.
    const chosen = nextToSync(
      [org('recent', { syncedAt: hoursAgo(1.5) }), org('stale', { syncedAt: hoursAgo(9) })],
      NOW,
    );

    expect(chosen?.orgId).toBe('stale');
  });

  it('puts a co-op that has never synced ahead of everything', () => {
    const chosen = nextToSync(
      [org('old', { syncedAt: hoursAgo(50) }), org('new', { syncedAt: null })],
      NOW,
    );

    expect(chosen?.orgId).toBe('new');
  });

  it('leaves alone anything synced within the interval', () => {
    // Running a full pass four times an hour would spend a Google quota
    // re-reading entries nobody has touched.
    expect(nextToSync([org('fresh', { syncedAt: hoursAgo(0.25) })], NOW)).toBeNull();
  });

  it('picks one, never all of them', () => {
    // Each costs Google reads and a Lambda's wall clock; a hundred co-ops in a
    // loop would hit the limit on whichever happened to be last.
    const chosen = nextToSync(
      [org('a', { syncedAt: hoursAgo(5) }), org('b', { syncedAt: hoursAgo(6) })],
      NOW,
    );

    expect(chosen).not.toBeNull();
    expect(typeof chosen?.orgId).toBe('string');
  });

  it('has nothing to do when nobody has connected a calendar', () => {
    expect(nextToSync([], NOW)).toBeNull();
  });

  it('comes round again about once an hour', () => {
    expect(SYNC_INTERVAL_MS).toBe(60 * 60 * 1000);
    // And looks a month back rather than a year: this keeps an already-imported
    // calendar true, and changes to last March are not what anybody is waiting
    // on. Fewer pages is the difference between a few ticks and all afternoon.
    expect(SYNC_MONTHS_BACK).toBeLessThan(12);
  });
});

describe('what a chunk writes down', () => {
  it('keeps the cursor while a pass is still going', () => {
    const written = afterChunk({ calendar: 2, page: 'tok', entry: 0 }, NOW);

    expect(written.calendarSyncCursor).toEqual({ calendar: 2, page: 'tok', entry: 0 });
    // Not finished, so it has not been synced.
    expect(written.calendarSyncedAt).toBeUndefined();
  });

  it('stamps the time only when the pass actually finishes', () => {
    /*
      Stamping on every chunk would read "synced a minute ago" through an
      eight-tick pass, and the next interval would start a fresh pass on top
      of the unfinished one.
    */
    const written = afterChunk(null, NOW);

    expect(written.calendarSyncCursor).toBeNull();
    expect(written.calendarSyncedAt).toEqual(NOW);
  });

  it('clears an old error on any successful chunk', () => {
    expect(afterChunk(null, NOW).calendarSyncError).toBeNull();
    expect(afterChunk({ calendar: 1 }, NOW).calendarSyncError).toBeNull();
  });
});

describe('what a failure writes down', () => {
  it('drops the cursor, so the next pass starts over rather than resuming past it', () => {
    // Imports are idempotent — an upsert per entry keyed on the Google id — so
    // starting over costs time and nothing else, while resuming would skip
    // whatever it failed on.
    expect(afterFailure('invalid_grant').calendarSyncCursor).toBeNull();
  });

  it('keeps the reason, because this runs with nobody watching', () => {
    // A sync failing all week against a revoked token looks exactly like a
    // sync with nothing to do.
    expect(afterFailure('invalid_grant').calendarSyncError).toBe('invalid_grant');
  });

  it('does not move the synced time, since nothing finished', () => {
    expect(afterFailure('boom')).not.toHaveProperty('calendarSyncedAt');
  });

  it('trims a reason too long for the column', () => {
    const long = afterFailure('x'.repeat(900)).calendarSyncError;
    expect(long.length).toBeLessThanOrEqual(500);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('a chunk always moves', () => {
  const { nextCursor } = require('../import-cursor');
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'calendar-import.service.ts'),
    'utf8',
  );

  it('returns the very same cursor when a chunk handled nothing', () => {
    /*
      The hazard this guards, stated as the arithmetic that causes it.

      `nextCursor` moves by how many entries were handled. Handle none and it
      hands back the position it was given — which an admin pressing a button
      would notice as "nothing happened", and an unattended pass would not.
      It would read the same page every fifteen minutes, forever.
    */
    const stuck = nextCursor(0, 9, { token: null, nextToken: null, length: 274 }, 48, 0);
    expect(stuck).toEqual({ calendar: 0, page: null, entry: 48 });

    const moved = nextCursor(0, 9, { token: null, nextToken: null, length: 274 }, 48, 1);
    expect(moved).toEqual({ calendar: 0, page: null, entry: 49 });
  });

  it('never checks the clock before the first entry of a chunk', () => {
    // So `handled` is at least one whenever there is anything to handle, and
    // the cursor always advances. One entry a tick is slow; none is stuck.
    const checks = source.match(/if \(index > 0 && outOfTime\(\)\) break;/g) ?? [];
    expect(checks.length).toBe(2); // events and bookings
    expect(source).not.toMatch(/\n      if \(outOfTime\(\)\) break;/);
  });
});
