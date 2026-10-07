import { readFileSync } from 'fs';
import { join } from 'path';
import {
  MEMBER_FILTER_GROUPS,
  SORT_OPTIONS,
  activeFilterCount,
  clearedFilters,
  describeActive,
  emptyMessage,
  withFilter,
} from '@/lib/member-filters';

/**
 * Narrowing a roster of four hundred (MEM-26).
 *
 * The list had a search box and nothing else. Every question an organiser
 * actually asks — who has never signed in, who is past due, who is on no
 * tier, whose email is bouncing — meant paging through twenty at a time.
 */
describe('setting a filter', () => {
  it('clears the key when the empty option is chosen', () => {
    // The "Any role" option. Sending `role=` would be a filter matching
    // nothing rather than a filter that is off.
    expect(withFilter({ role: 'STAFF' }, 'role', '')).toEqual({});
  });

  it('leaves the other filters alone', () => {
    expect(withFilter({ role: 'STAFF', status: 'ACTIVE' }, 'status', 'PAST_DUE')).toEqual({
      role: 'STAFF',
      status: 'PAST_DUE',
    });
  });

  it('does not mutate what it was given', () => {
    // It is React state, and the request key is derived from its contents.
    const before = { role: 'STAFF' };
    withFilter(before, 'status', 'ACTIVE');
    expect(before).toEqual({ role: 'STAFF' });
  });
});

describe('counting what is narrowing the list', () => {
  it('does not count the sort', () => {
    // Ordering a list hides nobody. Counting it would badge a roster that is
    // showing everybody.
    expect(activeFilterCount({ sort: 'name-asc' })).toBe(0);
  });

  it('counts each filter once', () => {
    expect(activeFilterCount({ role: 'STAFF', flag: 'bounced', sort: 'name-asc' })).toBe(2);
  });

  it('clears back to the whole roster in its usual order', () => {
    expect(clearedFilters()).toEqual({ sort: 'joined-desc' });
    expect(activeFilterCount(clearedFilters())).toBe(0);
  });
});

describe('what the chips say', () => {
  const tiers = [{ id: 'tier-1', name: 'Believer' }];

  it('names a tier rather than showing its id', () => {
    expect(describeActive({ tierId: 'tier-1' }, tiers)).toEqual([
      { key: 'tierId', label: 'Believer' },
    ]);
  });

  it('still says something for a tier that has since been deleted', () => {
    expect(describeActive({ tierId: 'tier-gone' }, tiers)[0].label).toMatch(/no longer exists/);
  });

  it('distinguishes "no tier" from a tier', () => {
    expect(describeActive({ tierId: 'none' }, tiers)).toEqual([
      { key: 'tierId', label: 'On no tier' },
    ]);
  });

  it('uses the organiser’s wording, not the column name', () => {
    expect(describeActive({ activity: 'never' }, tiers)).toEqual([
      { key: 'activity', label: 'Never signed in' },
    ]);
  });

  it('says nothing when nothing is set', () => {
    expect(describeActive({ sort: 'name-asc' }, tiers)).toEqual([]);
  });
});

describe('an empty list', () => {
  it('blames the filters when the filters did it', () => {
    // Telling somebody whose import worked that there are "no members yet" is
    // how they go looking for a bug that is not there.
    expect(emptyMessage({ role: 'STAFF' }, false)).toBe('Nobody matches these filters.');
  });

  it('names both when both are on', () => {
    expect(emptyMessage({ role: 'STAFF' }, true)).toMatch(/search with these filters/);
  });

  it('blames the search when only the search is on', () => {
    expect(emptyMessage({}, true)).toBe('Nobody matches that search.');
  });

  it('says the roster is empty only when it really is', () => {
    expect(emptyMessage({}, false)).toBe('No members yet.');
  });
});

describe('what is offered', () => {
  it('offers every dues status, so none of them is a dead end', () => {
    const dues = MEMBER_FILTER_GROUPS.find((group) => group.key === 'status');
    expect(dues?.options.map((o) => o.value).sort()).toEqual(
      ['ACTIVE', 'CANCELED', 'COMP', 'NONE', 'PAST_DUE', 'TRIALING'].sort(),
    );
  });

  it('offers the things that need acting on, including a bounced address', () => {
    const flags = MEMBER_FILTER_GROUPS.find((group) => group.key === 'flag');
    expect(flags?.options.map((o) => o.value)).toContain('bounced');
    expect(flags?.options.map((o) => o.value)).toContain('hidden');
  });

  it('calls the away-longest sort what it is', () => {
    // Members who have never signed in come first in that order, so calling
    // it "oldest sign-in" would be wrong.
    const option = SORT_OPTIONS.find((o) => o.value === 'last-seen-asc');
    expect(option?.label).toBe('Away the longest');
  });

  it('every group has an option meaning "do not filter on this"', () => {
    for (const group of MEMBER_FILTER_GROUPS) {
      expect(group.anyLabel).toBeTruthy();
      expect(group.options.some((o) => o.value === '')).toBe(false);
    }
  });
});

describe('the page', () => {
  const source = readFileSync(
    join(
      __dirname,
      '..',
      'app',
      '(app)',
      '(dashboard)',
      'admin',
      '[orgSlug]',
      'members',
      'page.tsx',
    ),
    'utf8',
  );
  const code = source.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/\/\/.*$/gm, '');

  it('asks the server to narrow the list, not the browser', () => {
    // MEM-22 moved searching to the server after a 426-member co-op searched
    // the 50 rows it was holding. Filtering must not undo that.
    expect(code).toMatch(/api\.members\.list\(orgId, token, 1, PER_PAGE, query \|\| undefined, filters\)/);
  });

  it('carries the same filters into the next page', () => {
    // Otherwise "load more" fetches a different list and appends it to this one.
    const loadMore = code.slice(code.indexOf('async function loadMore'));
    expect(loadMore.slice(0, 600)).toMatch(/filters,/);
  });

  it('re-requests on a changed filter without re-requesting on every render', () => {
    // The object is a new reference each render; the string is not.
    expect(code).toMatch(/const filterKey = JSON\.stringify\(filters\)/);
    expect(code).toMatch(/\[query, filterKey\]/);
  });

  it('shows how many match from the server’s count, not the rows loaded', () => {
    expect(code).toMatch(/data\?\.meta\?\.total/);
  });
});
