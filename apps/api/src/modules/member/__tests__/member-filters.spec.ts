import {
  DEFAULT_SORT,
  isNarrowed,
  isPrivilegedSort,
  orderFor,
  parseFilters,
  whereFor,
} from '../member-filters';

/**
 * Narrowing a roster of four hundred (MEM-26).
 *
 * The list had a search box and nothing else: 437 people, ordered by join
 * date, twenty at a time.
 *
 * The failures worth pinning are the ones that would leak. This endpoint also
 * serves the member directory, and a filter is a way of reading a fact one
 * yes-or-no at a time — "show me everybody who is past due", tried once per
 * status, is the dues column the directory has never shown.
 */
describe('reading the filters', () => {
  const asMember = (raw: Record<string, string>) => parseFilters(raw, false);
  const asOrganiser = (raw: Record<string, string>) => parseFilters(raw, true);

  it('gives an organiser what they asked for', () => {
    const filters = asOrganiser({
      role: 'STAFF',
      status: 'PAST_DUE',
      activity: 'never',
      flag: 'bounced',
      sort: 'name-asc',
    });

    expect(filters).toMatchObject({
      role: 'STAFF',
      status: 'PAST_DUE',
      activity: 'never',
      flag: 'bounced',
      sort: 'name-asc',
    });
  });

  it('drops the dues filter for an ordinary member', () => {
    // Tried once per status, this answers "who here is behind on their dues?"
    // without ever printing a status.
    expect(asMember({ status: 'PAST_DUE' }).status).toBeUndefined();
  });

  it('drops the sign-in filter for an ordinary member', () => {
    expect(asMember({ activity: 'never' }).activity).toBeUndefined();
  });

  it('drops the organiser flags for an ordinary member', () => {
    // A bounced address is a fact about somebody's email, which the directory
    // has never shown.
    expect(asMember({ flag: 'bounced' }).flag).toBeUndefined();
    expect(asMember({ flag: 'hidden' }).flag).toBeUndefined();
  });

  it('refuses to order an ordinary member’s list by something they cannot see', () => {
    // Ordering by a hidden fact leaks it as surely as printing it: the first
    // row of "sort by status" is somebody's billing state.
    expect(asMember({ sort: 'status' }).sort).toBe(DEFAULT_SORT);
    expect(asMember({ sort: 'last-seen-desc' }).sort).toBe(DEFAULT_SORT);
    expect(isPrivilegedSort('status')).toBe(true);
  });

  it('still lets an ordinary member sort by name and join date', () => {
    expect(asMember({ sort: 'name-asc' }).sort).toBe('name-asc');
    expect(asMember({ sort: 'joined-asc' }).sort).toBe('joined-asc');
  });

  it('drops a value it does not recognise rather than guessing', () => {
    // A misspelled status that matched everything would be a filter that looks
    // applied and is not.
    expect(asOrganiser({ status: 'OVERDUE' }).status).toBeUndefined();
    expect(asOrganiser({ role: 'OWNER' }).role).toBeUndefined();
    expect(asOrganiser({ sort: 'whatever' }).sort).toBe(DEFAULT_SORT);
    expect(asOrganiser({ activity: 'maybe' }).activity).toBeUndefined();
  });

  it('reads a role or status whatever case it arrives in', () => {
    expect(asOrganiser({ role: 'staff' }).role).toBe('STAFF');
    expect(asOrganiser({ status: 'past_due' }).status).toBe('PAST_DUE');
  });

  it('treats an empty search as no search', () => {
    expect(asOrganiser({ search: '   ' }).search).toBeUndefined();
  });

  it('knows when nothing is narrowing the list', () => {
    expect(isNarrowed(asOrganiser({}))).toBe(false);
    expect(isNarrowed(asOrganiser({ sort: 'name-asc' }))).toBe(false);
    expect(isNarrowed(asOrganiser({ role: 'STAFF' }))).toBe(true);
  });
});

describe('the conditions they describe', () => {
  const organiser = (raw: Record<string, string>) => whereFor(parseFilters(raw, true));

  it('finds members who have never signed in', () => {
    expect(organiser({ activity: 'never' })).toEqual({ user: { lastLoginAt: null } });
  });

  it('finds members whose address bounced', () => {
    expect(organiser({ flag: 'bounced' })).toEqual({ signInBouncedAt: { not: null } });
  });

  it('separates "no tier" from a real tier id', () => {
    // `none` has to mean null rather than a tier literally called none.
    expect(organiser({ tierId: 'none' })).toEqual({ tierId: null });
    expect(organiser({ tierId: 'tier-7' })).toEqual({ tierId: 'tier-7' });
  });

  it('finds members who have hidden themselves from the directory', () => {
    // An organiser wondering why somebody is missing has no other way to tell.
    expect(organiser({ flag: 'hidden' })).toEqual({ isPublic: false });
  });

  it('describes nothing at all when nothing was asked', () => {
    // So the caller's own tenant scope is the only condition left.
    expect(organiser({})).toEqual({});
  });

  it('never names an organisation, so it cannot widen the tenant scope', () => {
    const keys = Object.keys(
      organiser({ role: 'STAFF', status: 'ACTIVE', activity: 'never', flag: 'bounced' }),
    );
    expect(keys).not.toContain('orgId');
  });
});

describe('the order', () => {
  it('defaults to newest members first', () => {
    expect(orderFor(DEFAULT_SORT)).toEqual([{ memberSince: 'desc' }]);
  });

  it('puts the people who have never signed in last, not first', () => {
    // An organiser asking who has been in recently does not want four hundred
    // people who never have at the top of the answer.
    expect(orderFor('last-seen-desc')).toEqual([
      { user: { lastLoginAt: { sort: 'desc', nulls: 'last' } } },
    ]);
  });

  it('puts them first when that is the question being asked', () => {
    expect(orderFor('last-seen-asc')).toEqual([
      { user: { lastLoginAt: { sort: 'asc', nulls: 'first' } } },
    ]);
  });

  it('orders tiers the way the co-op ranked them, not alphabetically', () => {
    expect(orderFor('tier')[0]).toEqual({ tier: { sortOrder: 'asc' } });
  });

  it('sorts names on the account, since that is where the name lives', () => {
    expect(orderFor('name-asc')).toEqual([{ user: { name: 'asc' } }]);
  });
});
