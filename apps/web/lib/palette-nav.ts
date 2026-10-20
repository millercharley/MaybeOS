/**
 * Where a search result goes (UI-04).
 *
 * The palette read the co-op out of the address — `useParams().orgSlug` — and
 * cast it to a string. That cast was the bug: the palette is rendered on
 * every signed-in page, and several of them have no co-op in the address at
 * all. `/platform` is one, which is how Charley found this: he suspended a
 * duplicate co-op from the MaybeOS console, searched for the member who made
 * it, and was sent to `/admin/undefined/members` — a page that told him he
 * was not a member of "undefined".
 *
 * Nothing failed. TypeScript was satisfied, the router did as it was asked,
 * and the destination was a string containing the word "undefined".
 */

/** A co-op the signed-in person belongs to, as the auth store holds it. */
export interface Membership {
  orgId: string;
  org?: { slug?: string } | null;
}

/**
 * The co-op a search should act on.
 *
 * The address first, because it is where the person is looking. Then the
 * co-op they have open, then the only one they have — and null when there is
 * genuinely no answer, which a platform admin with no membership of their own
 * can reach.
 */
export function resolveOrgSlug(
  urlSlug: string | undefined,
  orgs: Membership[] | undefined,
  currentOrgId: string | null | undefined,
): string | null {
  if (urlSlug) return urlSlug;

  const current = orgs?.find((o) => o.orgId === currentOrgId)?.org?.slug;
  if (current) return current;

  return orgs?.[0]?.org?.slug ?? null;
}

export type ResultKind = 'channel' | 'page' | 'event' | 'member';

/**
 * The address for one result, or null when there is nowhere to send them.
 *
 * Returning null rather than a path built from nothing is the whole point:
 * a string with "undefined" in it is a destination the router will happily
 * go to, and the error it lands on blames the person for a link the product
 * wrote.
 */
export function paletteHref(kind: ResultKind, id: string, slug: string | null): string | null {
  if (!slug) return null;

  switch (kind) {
    case 'channel':
      return `/admin/${slug}/commons?channel=${encodeURIComponent(id)}`;
    case 'page':
      return `/admin/${slug}/commons?page=${encodeURIComponent(id)}`;
    case 'event':
      return `/admin/${slug}/events`;
    case 'member':
      return `/admin/${slug}/members`;
  }
}
