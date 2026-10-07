/**
 * Finding somebody in a roster of four hundred (MEM-26).
 *
 * The members list had a search box and nothing else: one text field over 437
 * people, ordered by join date, twenty at a time. Every question an admin
 * actually asks — who has never signed in, who is past due, who is on the
 * Believer tier, whose email is bouncing — meant paging.
 *
 * Two rules shape everything here.
 *
 * **Most of these filters are organisers-only.** This endpoint also serves the
 * member directory. Letting an ordinary member filter by subscription status
 * would answer "is this person behind on their dues?" about everybody in the
 * co-op without ever showing a status — the same oracle the email search was
 * closed for. A filter nobody is allowed to use is *dropped*, not refused,
 * because a 403 is itself an answer about what exists.
 *
 * **An unknown value is dropped, never guessed.** These arrive on a query
 * string. A misspelled status that silently matched everything would be a
 * filter that looks applied and is not, which is worse than no filter.
 */

export type MemberSort =
  | 'joined-desc'
  | 'joined-asc'
  | 'name-asc'
  | 'name-desc'
  | 'last-seen-desc'
  | 'last-seen-asc'
  | 'tier'
  | 'status';

export const MEMBER_SORTS: MemberSort[] = [
  'joined-desc',
  'joined-asc',
  'name-asc',
  'name-desc',
  'last-seen-desc',
  'last-seen-asc',
  'tier',
  'status',
];

export const DEFAULT_SORT: MemberSort = 'joined-desc';

export const MEMBER_ROLES = ['ADMIN', 'STAFF', 'MEMBER', 'GUEST'] as const;
export const MEMBER_STATUSES = [
  'NONE',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'TRIALING',
  'COMP',
] as const;

/** Whether they have ever signed in. Not the same question as having a tier. */
export type ActivityFilter = 'signed-in' | 'never';

/** Something an organiser needs to act on, rather than a property of the member. */
export type FlagFilter = 'bounced' | 'no-tier' | 'hidden';

export interface MemberFilters {
  search?: string;
  role?: string;
  /** A tier's id, or `none` for members who have not been put on one. */
  tierId?: string;
  status?: string;
  activity?: ActivityFilter;
  flag?: FlagFilter;
  sort: MemberSort;
}

/** The raw query string, before anything has been believed. */
export interface RawFilters {
  search?: string;
  role?: string;
  tierId?: string;
  status?: string;
  activity?: string;
  flag?: string;
  sort?: string;
}

/**
 * Which filters are an organiser's alone.
 *
 * Dues, sign-in history and a bounced address are all facts the directory has
 * never shown one member about another, and a filter is a way of reading a
 * fact one yes-or-no at a time.
 */
export function isPrivileged(filter: keyof RawFilters): boolean {
  return filter === 'status' || filter === 'activity' || filter === 'flag';
}

/** Sorts that would order the list by something an ordinary member may not see. */
export function isPrivilegedSort(sort: MemberSort): boolean {
  return sort === 'status' || sort === 'last-seen-desc' || sort === 'last-seen-asc';
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  if (!value) return undefined;
  const match = allowed.find((item) => item === value.trim().toUpperCase());
  return match;
}

/**
 * Read the query string into something the query can be built from.
 *
 * Everything unrecognised falls away, so the worst a bad URL can do is show
 * the whole list.
 */
export function parseFilters(raw: RawFilters, privileged: boolean): MemberFilters {
  const search = raw.search?.trim() || undefined;

  const role = oneOf(raw.role, MEMBER_ROLES);
  const status = privileged ? oneOf(raw.status, MEMBER_STATUSES) : undefined;

  const tierId = raw.tierId?.trim() || undefined;

  const activity =
    privileged && (raw.activity === 'signed-in' || raw.activity === 'never')
      ? (raw.activity as ActivityFilter)
      : undefined;

  const flag =
    privileged && (raw.flag === 'bounced' || raw.flag === 'no-tier' || raw.flag === 'hidden')
      ? (raw.flag as FlagFilter)
      : undefined;

  let sort = MEMBER_SORTS.find((item) => item === raw.sort) ?? DEFAULT_SORT;
  // Ordering by a fact somebody may not see leaks it just as surely as
  // printing it: "sort by who is past due" reads a list of who is past due.
  if (!privileged && isPrivilegedSort(sort)) sort = DEFAULT_SORT;

  return { search, role, tierId, status, activity, flag, sort };
}

/** Is anything narrowing the list? Drives the "showing all" wording. */
export function isNarrowed(filters: MemberFilters): boolean {
  return Boolean(
    filters.search || filters.role || filters.tierId || filters.status || filters.activity || filters.flag,
  );
}

/**
 * How to order the rows.
 *
 * Name sorts on the user, the rest on the membership. `nulls: 'last'` on last
 * seen is the point of that sort: an organiser asking who has been in recently
 * does not want four hundred people who never have at the top, and an
 * organiser asking the opposite wants exactly them — which is `last-seen-asc`,
 * where nulls come first.
 */
export function orderFor(sort: MemberSort): Record<string, unknown>[] {
  switch (sort) {
    case 'joined-asc':
      return [{ memberSince: 'asc' }];
    case 'name-asc':
      return [{ user: { name: 'asc' } }];
    case 'name-desc':
      return [{ user: { name: 'desc' } }];
    case 'last-seen-desc':
      return [{ user: { lastLoginAt: { sort: 'desc', nulls: 'last' } } }];
    case 'last-seen-asc':
      return [{ user: { lastLoginAt: { sort: 'asc', nulls: 'first' } } }];
    case 'tier':
      // By the co-op's own order, not the tier's name: a tier list is ranked,
      // and alphabetical would scatter it.
      return [{ tier: { sortOrder: 'asc' } }, { memberSince: 'desc' }];
    case 'status':
      return [{ subscriptionStatus: 'asc' }, { memberSince: 'desc' }];
    case 'joined-desc':
    default:
      return [{ memberSince: 'desc' }];
  }
}

/**
 * The `where` these filters describe, minus the search and the org.
 *
 * Returned as a plain object so the shape can be read and tested without a
 * database. The caller merges it with its own tenant scope — never the other
 * way round, so nothing here can widen what org the rows come from.
 */
export function whereFor(filters: MemberFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  if (filters.role) where.role = filters.role;

  if (filters.tierId === 'none') where.tierId = null;
  else if (filters.tierId) where.tierId = filters.tierId;

  if (filters.status) where.subscriptionStatus = filters.status;

  if (filters.activity === 'signed-in') where.user = { lastLoginAt: { not: null } };
  if (filters.activity === 'never') where.user = { lastLoginAt: null };

  // A bounced sign-in email (MEM-25): the member who looks like they are
  // ignoring you and has in fact never been reachable.
  if (filters.flag === 'bounced') where.signInBouncedAt = { not: null };
  if (filters.flag === 'no-tier') where.tierId = null;
  // Hidden from the directory by their own choice (FRM-01). Worth being able
  // to find, because an organiser wondering why somebody is missing from the
  // member list has no other way to tell.
  if (filters.flag === 'hidden') where.isPublic = false;

  return where;
}
