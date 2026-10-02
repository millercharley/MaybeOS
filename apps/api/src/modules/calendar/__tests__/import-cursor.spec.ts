import { deadline, nextCursor, startOf, WRITE_BUDGET_MS } from '../import-cursor';

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
    expect(startOf(null)).toEqual({ calendar: 0, entry: 0 });
    expect(startOf(undefined)).toEqual({ calendar: 0, entry: 0 });
  });

  it('resumes where the last request stopped', () => {
    expect(startOf({ calendar: 2, entry: 150 })).toEqual({ calendar: 2, entry: 150 });
  });

  it('refuses to index backwards', () => {
    // These arrive in a request body. A negative offset would slice from the
    // end of the entry list and import the wrong things.
    expect(startOf({ calendar: -3, entry: -9 })).toEqual({ calendar: 0, entry: 0 });
  });

  it('refuses a fraction of a row', () => {
    expect(startOf({ calendar: 1.7, entry: 2.5 })).toEqual({ calendar: 1, entry: 2 });
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
  it('stays on the same calendar when there is more of it', () => {
    expect(nextCursor(0, 100, 420, 9, 0)).toEqual({ calendar: 0, entry: 100 });
  });

  it('counts from where this chunk started, not from zero', () => {
    // The bug this prevents: a second chunk reporting "100 written" and
    // being resumed at 100 would import entries 100–200 twice and never
    // reach the end.
    expect(nextCursor(0, 100, 420, 9, 100)).toEqual({ calendar: 0, entry: 200 });
  });

  it('moves to the next calendar when this one is finished', () => {
    expect(nextCursor(0, 320, 420, 9, 100)).toEqual({ calendar: 1, entry: 0 });
  });

  it('is finished after the last calendar', () => {
    expect(nextCursor(8, 12, 12, 9, 0)).toBeNull();
  });

  it('does not loop forever on an empty calendar', () => {
    // Nothing written and nothing to write is finished, not stuck.
    expect(nextCursor(3, 0, 0, 9, 0)).toEqual({ calendar: 4, entry: 0 });
  });

  it('is finished when an empty calendar is the last one', () => {
    expect(nextCursor(8, 0, 0, 9, 0)).toBeNull();
  });
});
