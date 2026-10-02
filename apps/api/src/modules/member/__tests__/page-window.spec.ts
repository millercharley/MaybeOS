import { MAX_PER_PAGE, pageWindow } from '../page-window';

/**
 * How much of a roster one request may ask for (MEM-22).
 *
 * The admin Members page asked for the first 50 and drew them with nothing
 * that reached the rest, so MaybeItsFate's 426 members looked like 50 —
 * including to the search box, which filtered the 50 already in the browser
 * and answered "no members found" for anybody further down.
 *
 * Fixing that hands the page size to the client, and a number that arrives
 * in a query string is a number somebody can make up.
 */

describe('the window a list request gets', () => {
  it('passes an ordinary request through untouched', () => {
    expect(pageWindow(3, 50)).toEqual({ page: 3, perPage: 50, skip: 100, take: 50 });
  });

  it('starts at the first page, never before it', () => {
    // A negative skip is an error from Prisma, which is a 500 to whoever is
    // looking at the page.
    expect(pageWindow(0, 20).skip).toBe(0);
    expect(pageWindow(-5, 20)).toMatchObject({ page: 1, skip: 0 });
  });

  it('caps how much one request can take', () => {
    expect(pageWindow(1, 10_000)).toMatchObject({ perPage: MAX_PER_PAGE, take: MAX_PER_PAGE });
  });

  it('refuses to take nothing', () => {
    expect(pageWindow(1, 0).take).toBe(1);
    expect(pageWindow(1, -3).take).toBe(1);
  });

  it('survives a query string that is not a number', () => {
    // `ParseIntPipe` gives NaN for some inputs, and NaN fails every
    // comparison — so a naive `perPage > MAX` check lets it straight through
    // to the database.
    expect(pageWindow(NaN, NaN)).toEqual({ page: 1, perPage: 20, skip: 0, take: 20 });
    expect(pageWindow(Infinity, Infinity)).toEqual({ page: 1, perPage: 20, skip: 0, take: 20 });
  });

  it('ignores a fractional page rather than skipping a fraction of a row', () => {
    expect(pageWindow(2.7, 25)).toMatchObject({ page: 2, skip: 25 });
  });

  it('is wide enough for a roster page this product actually draws', () => {
    // MaybeItsFate has 426 members and the page loads 50 at a time.
    expect(MAX_PER_PAGE).toBeGreaterThanOrEqual(50);
  });
});
