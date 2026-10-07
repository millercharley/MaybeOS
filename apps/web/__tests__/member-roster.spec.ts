import { readFileSync } from 'fs';
import { join } from 'path';
import {
  PER_PAGE,
  appendPage,
  hasMore,
  rosterCount,
} from '@/lib/member-roster';

/**
 * Seeing the whole roster (MEM-22).
 *
 * The admin Members page fetched the first 50 and drew them with nothing that
 * reached the rest, so MaybeItsFate's 426 members looked like 50. The quieter
 * half was the search box: it filtered the rows the browser was holding, so
 * searching a 426-member co-op searched 50 of them and said nobody matched —
 * which reads exactly like the member not being there.
 */

const meta = (total: number) => ({ total, page: 1, perPage: PER_PAGE, totalPages: Math.ceil(total / PER_PAGE) });

describe('whether there is more to load', () => {
  it('is true while fewer are shown than exist', () => {
    expect(hasMore(50, meta(426))).toBe(true);
  });

  it('is false once they are all here', () => {
    expect(hasMore(426, meta(426))).toBe(false);
  });

  it('is false before anything is known', () => {
    expect(hasMore(0, null)).toBe(false);
  });
});

describe('what the page says about the size of the roster', () => {
  it('says how many are shown and how many there are', () => {
    // The sentence that would have made the bug visible on day one.
    expect(rosterCount(50, meta(426), false)).toBe('Showing 50 of 426 members.');
  });

  it('stops counting once everyone is there', () => {
    expect(rosterCount(426, meta(426), false)).toBe('All 426 members.');
  });

  it('counts one member as one', () => {
    expect(rosterCount(1, meta(1), false)).toBe('All 1 member.');
  });

  it('separates a search result from the roster itself', () => {
    // "Showing 50 of 426" under a search would be read as the co-op's size.
    expect(rosterCount(12, meta(12), true)).toBe('12 members match that search.');
    expect(rosterCount(50, meta(120), true)).toBe(
      'Showing 50 of 120 members matching that search.',
    );
  });

  it('says plainly when a search found nobody', () => {
    expect(rosterCount(0, meta(0), true)).toBe('No members match that search.');
  });

  it('does not call an empty co-op a failed search', () => {
    expect(rosterCount(0, meta(0), false)).toBe('No members yet.');
  });

  it('groups the digits of a number nobody wants to count', () => {
    expect(rosterCount(50, meta(3200), false)).toBe('Showing 50 of 3,200 members.');
  });
});

describe('adding a page to the ones already shown', () => {
  const member = (id: string) => ({ id });

  it('appends in order', () => {
    expect(appendPage([member('a')], [member('b')]).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('never shows the same member twice', () => {
    // The roster is ordered by join date, so somebody joining while an
    // organiser reads it shifts every later row down one and page 2 repeats
    // a name from page 1. On this page a duplicate reads as a duplicated
    // membership, which is alarming.
    expect(appendPage([member('a'), member('b')], [member('b'), member('c')]).map((m) => m.id))
      .toEqual(['a', 'b', 'c']);
  });

  it('handles a page that is entirely repeats', () => {
    expect(appendPage([member('a')], [member('a')]).map((m) => m.id)).toEqual(['a']);
  });
});

describe('the page is wired to all of it', () => {
  const page = readFileSync(
    join(__dirname, '..', 'app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'members', 'page.tsx'),
    'utf8',
  );

  it('asks the server to search, not the browser', () => {
    // The old code filtered `members` in place. Nothing may do that again.
    expect(page).not.toMatch(/\.filter\(\s*\(m\) =>/);
    expect(page).toMatch(/api\.members\.list\([\s\S]{0,120}query \|\| undefined/);
  });

  it('refetches when the search changes', () => {
    // Alongside the filter key since MEM-26 — both narrow the same request,
    // and either changing means the list starts again from page one.
    expect(page).toMatch(/\[query, filterKey\]/);
  });

  it('waits before searching, rather than firing on every keystroke', () => {
    expect(page).toMatch(/SEARCH_DEBOUNCE_MS/);
  });

  it('offers a way to load the rest', () => {
    expect(page).toMatch(/onClick=\{loadMore\}/);
    expect(page).toMatch(/hasMore\(/);
  });

  it('throws away later pages when the first one changes', () => {
    // They belonged to the previous search.
    expect(page).toMatch(/setMore\(\[\]\)/);
  });

  it('does not replace the page with a spinner while searching', () => {
    // A spinner in place of the page unmounts the search box and takes the
    // cursor with it, so typing a third letter is impossible.
    expect(page).toMatch(/if \(loading && !data\)/);
    expect(page).toMatch(/if \(error && !data\)/);
  });
});
