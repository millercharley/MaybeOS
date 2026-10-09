import { deadline, nextCursor, startOf, WRITE_BUDGET_MS, budget } from '../import-cursor';

/**
 * Importing a calendar in pieces (CAL-05).
 *
 * MaybeItsFate's import returned 504. Nine calendars and a year of entries do
 * not fit in a Lambda's wall clock, and when it ran out the whole run was
 * lost — along with any way of telling whether it had got nowhere or nearly
 * all the way.
 *
 * Found the way the first one was: Charley pressed the button and got
 * "request failed". The web error carried `api.status: 504`, and there was no
 * matching error from the API at all, which is what a timeout looks like.
 */

describe('where to start', () => {
  it('starts at the beginning when there is no cursor', () => {
    expect(startOf(null)).toEqual({ calendar: 0, page: null, entry: 0 });
    expect(startOf(undefined)).toEqual({ calendar: 0, page: null, entry: 0 });
  });

  it('resumes on the page the last request was reading', () => {
    // Without the page token every chunk re-read the calendar from the start
    // before it could slice its share out (CAL-06).
    expect(startOf({ calendar: 2, page: 'tok-3', entry: 150 })).toEqual({
      calendar: 2,
      page: 'tok-3',
      entry: 150,
    });
  });

  it('refuses to index backwards', () => {
    // These arrive in a request body. A negative offset would slice from the
    // end of the entry list and import the wrong things.
    expect(startOf({ calendar: -3, entry: -9 })).toEqual({ calendar: 0, page: null, entry: 0 });
  });

  it('refuses a fraction of a row', () => {
    expect(startOf({ calendar: 1.7, entry: 2.5 })).toEqual({ calendar: 1, page: null, entry: 2 });
  });
});

describe('the budget', () => {
  it('leaves a synchronous function room to answer', () => {
    // Netlify gives ten seconds, and reading from Google happens first.
    expect(WRITE_BUDGET_MS).toBeLessThan(10_000);
  });

  it('is not out of time at the start', () => {
    expect(deadline(5_000, () => 0)()).toBe(false);
  });

  it('is out of time once the budget is spent', () => {
    let now = 0;
    const spent = deadline(5_000, () => now);

    now = 4_999;
    expect(spent()).toBe(false);
    now = 5_000;
    expect(spent()).toBe(true);
  });
});

describe('where to pick up next', () => {
  const page = (over: Partial<{ token: string | null; nextToken: string | null; length: number }> = {}) => ({
    token: null as string | null,
    nextToken: 'tok-2' as string | null,
    length: 250,
    ...over,
  });

  it('stays on the same page when there is more of it', () => {
    expect(nextCursor(0, 9, page(), 0, 100)).toEqual({ calendar: 0, page: null, entry: 100 });
  });

  it('counts from where this chunk started, not from zero', () => {
    // The arithmetic that would otherwise re-import the same slice forever:
    // a second chunk reporting "100 written" and resumed at 100.
    expect(nextCursor(0, 9, page({ token: 'tok-2' }), 100, 100)).toEqual({
      calendar: 0,
      page: 'tok-2',
      entry: 200,
    });
  });

  it('moves to Google’s next page when this one is done', () => {
    expect(nextCursor(0, 9, page({ nextToken: 'tok-2' }), 150, 100)).toEqual({
      calendar: 0,
      page: 'tok-2',
      entry: 0,
    });
  });

  it('moves to the next calendar when the pages run out', () => {
    expect(nextCursor(0, 9, page({ nextToken: null }), 150, 100)).toEqual({
      calendar: 1,
      page: null,
      entry: 0,
    });
  });

  it('is finished after the last calendar', () => {
    expect(nextCursor(8, 9, page({ nextToken: null, length: 12 }), 0, 12)).toBeNull();
  });

  it('does not loop forever on an empty calendar', () => {
    // Nothing read and nothing to write is finished, not stuck.
    expect(nextCursor(3, 9, page({ nextToken: null, length: 0 }), 0, 0)).toEqual({
      calendar: 4,
      page: null,
      entry: 0,
    });
  });

  it('is finished when an empty calendar is the last one', () => {
    expect(nextCursor(8, 9, page({ nextToken: null, length: 0 }), 0, 0)).toBeNull();
  });
});

/**
 * Asking whether there is *enough* time, not whether there is *any* (CAL-14).
 *
 * `deadline()` answers the second question, which is right between entries
 * and wrong before a read. A calendar taking five seconds against a
 * six-second budget passed the check at zero and again at five; the function
 * was killed at ten, and the cursor saying where to resume died with it.
 */
describe('budgeting for a read that has not happened yet', () => {
  /** A clock that only moves when told. */
  const clockFrom = (start: number) => {
    let at = start;
    return { now: () => at, advance: (ms: number) => (at += ms) };
  };

  it('allows a read while there is room for one', () => {
    const c = clockFrom(0);
    const b = budget(10_000, c.now);

    expect(b.roomForRead()).toBe(true);
  });

  it('refuses one when only a sliver is left, though time remains', () => {
    const c = clockFrom(0);
    const b = budget(10_000, c.now);
    c.advance(9_000);

    // The old check: a whole second left, so go ahead — and overshoot.
    expect(b.spent()).toBe(false);
    expect(b.roomForRead()).toBe(false);
  });

  it('learns from the reads it has seen', () => {
    /*
      The case the estimate alone cannot catch. Six-second reads against a
      sixteen-second budget: after two, four seconds remain — more than the
      2.5s guess, less than the six a read actually costs. Believing the
      guess starts a third and finishes at eighteen.
    */
    const c = clockFrom(0);
    const b = budget(16_000, c.now);

    let reads = 0;
    while (b.roomForRead() && reads < 10) {
      const startedAt = c.now();
      c.advance(6_000);
      b.record(startedAt);
      reads += 1;
    }

    expect(reads).toBe(2);
    expect(c.now()).toBeLessThanOrEqual(16_000);
  });

  it('keeps the slowest, not the latest', () => {
    // One slow calendar among quick ones still has to be planned for.
    const c = clockFrom(0);
    const b = budget(16_000, c.now);

    b.record(c.now());
    c.advance(7_000);
    b.record(c.now() - 7_000);
    c.advance(10);
    b.record(c.now() - 10);

    // 7,010 spent, ~9,000 left, and a read has cost 7,000 — room for one more.
    expect(b.roomForRead()).toBe(true);
    c.advance(2_000);
    // 9,010 spent, under 7,000 left. No.
    expect(b.roomForRead()).toBe(false);
  });
});
