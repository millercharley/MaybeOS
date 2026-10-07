import type { MemberListFilters, MemberSort } from './api';

/**
 * The ways an organiser narrows a roster (MEM-26).
 *
 * Kept out of the page so the wording and the arithmetic can be read and
 * tested on their own. The server decides what a given viewer is allowed to
 * ask for; this decides what an organiser is offered and what it is called.
 */

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterGroup {
  /** The key on `MemberListFilters` this group sets. */
  key: 'role' | 'status' | 'activity' | 'flag';
  label: string;
  /** Shown when nothing is chosen. */
  anyLabel: string;
  options: FilterOption[];
}

/**
 * Everything except tiers, which are the co-op's own and arrive from the API.
 *
 * The wording is deliberately the question an organiser is asking rather than
 * the column name: "Never signed in" is what somebody is looking for, and
 * `lastLoginAt IS NULL` is only how it is found.
 */
export const MEMBER_FILTER_GROUPS: FilterGroup[] = [
  {
    key: 'role',
    label: 'Role',
    anyLabel: 'Any role',
    options: [
      { value: 'ADMIN', label: 'Admins' },
      { value: 'STAFF', label: 'Staff' },
      { value: 'MEMBER', label: 'Members' },
      { value: 'GUEST', label: 'Guests' },
    ],
  },
  {
    key: 'status',
    label: 'Dues',
    anyLabel: 'Any dues status',
    options: [
      { value: 'ACTIVE', label: 'Active' },
      { value: 'PAST_DUE', label: 'Past due' },
      { value: 'CANCELED', label: 'Canceled' },
      { value: 'TRIALING', label: 'Trialing' },
      { value: 'COMP', label: 'Comped' },
      { value: 'NONE', label: 'No subscription' },
    ],
  },
  {
    key: 'activity',
    label: 'Signed in',
    anyLabel: 'Signed in or not',
    options: [
      { value: 'never', label: 'Never signed in' },
      { value: 'signed-in', label: 'Has signed in' },
    ],
  },
  {
    key: 'flag',
    label: 'Needs attention',
    anyLabel: 'Nothing in particular',
    options: [
      { value: 'bounced', label: 'Email bounced' },
      { value: 'no-tier', label: 'On no tier' },
      { value: 'hidden', label: 'Hidden from the directory' },
    ],
  },
];

/**
 * How the list can be ordered.
 *
 * "Longest away" rather than "oldest sign-in" because the people with no
 * sign-in at all come first, and calling that oldest would be wrong.
 */
export const SORT_OPTIONS: Array<{ value: MemberSort; label: string }> = [
  { value: 'joined-desc', label: 'Newest members first' },
  { value: 'joined-asc', label: 'Longest-standing first' },
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
  { value: 'last-seen-desc', label: 'Seen most recently' },
  { value: 'last-seen-asc', label: 'Away the longest' },
  { value: 'tier', label: 'Tier' },
  { value: 'status', label: 'Dues status' },
];

/**
 * How many filters are narrowing the list.
 *
 * The sort is not one of them — ordering a list does not hide anybody, and
 * counting it would put a badge on a roster showing everybody.
 */
export function activeFilterCount(filters: MemberListFilters): number {
  return (['role', 'tierId', 'status', 'activity', 'flag'] as const).filter(
    (key) => Boolean(filters[key]),
  ).length;
}

/** Everything cleared, back to the whole roster in its usual order. */
export function clearedFilters(): MemberListFilters {
  return { sort: 'joined-desc' };
}

/**
 * Set one filter, or clear it when the empty option is chosen.
 *
 * Returns a new object rather than mutating, because it is React state and
 * because the request key is derived from its contents.
 */
export function withFilter(
  filters: MemberListFilters,
  key: keyof MemberListFilters,
  value: string,
): MemberListFilters {
  const next = { ...filters };
  if (!value) delete next[key];
  else (next as Record<string, string>)[key] = value;
  return next;
}

/**
 * What to say when a narrowed list is empty.
 *
 * Distinct from an empty roster, which is a different problem and a different
 * sentence. An organiser who has filtered to nothing wants to know the filter
 * did that, not to wonder whether the import failed.
 */
export function emptyMessage(filters: MemberListFilters, searching: boolean): string {
  if (activeFilterCount(filters) > 0 && searching) {
    return 'Nobody matches that search with these filters.';
  }
  if (activeFilterCount(filters) > 0) return 'Nobody matches these filters.';
  if (searching) return 'Nobody matches that search.';
  return 'No members yet.';
}

/** The chips above the table, so an organiser can see and undo one at a time. */
export function describeActive(
  filters: MemberListFilters,
  tiers: Array<{ id: string; name: string }>,
): Array<{ key: keyof MemberListFilters; label: string }> {
  const chips: Array<{ key: keyof MemberListFilters; label: string }> = [];

  for (const group of MEMBER_FILTER_GROUPS) {
    const value = filters[group.key];
    if (!value) continue;
    const option = group.options.find((item) => item.value === value);
    if (option) chips.push({ key: group.key, label: option.label });
  }

  if (filters.tierId === 'none') {
    chips.push({ key: 'tierId', label: 'On no tier' });
  } else if (filters.tierId) {
    const tier = tiers.find((item) => item.id === filters.tierId);
    // Named, because a tier id tells an organiser nothing. A tier that has
    // since been deleted still has to say something.
    chips.push({ key: 'tierId', label: tier ? tier.name : 'A tier that no longer exists' });
  }

  return chips;
}
