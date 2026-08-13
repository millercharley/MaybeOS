import type { UserProfile } from './api';

/**
 * Where a person belongs immediately after signing in.
 *
 * Both sign-in paths used to hard-code `/admin`, so every member who signed
 * in — by password or by magic link — landed on "This page is for organisers"
 * and had to notice the small link back to their own dashboard. The gate
 * itself was right; sending them at it was not.
 *
 * This mirrors the dashboard layout's own test (`role === 'ADMIN' || 'STAFF'`
 * for the currently selected org) so the two cannot disagree — a redirect that
 * disagrees with the gate it feeds is how you get a loop.
 */
export function landingPathFor(
  user: Pick<UserProfile, 'orgs' | 'globalRole'>,
  currentOrgId?: string | null,
): string {
  if (user.globalRole === 'PLATFORM_ADMIN') {
    return '/admin';
  }

  // The layout auto-selects the first org when nothing is stored, so read the
  // role for whichever org it will actually be looking at.
  const org =
    user.orgs.find((o) => o.orgId === currentOrgId) ?? user.orgs[0] ?? null;

  return org?.role === 'ADMIN' || org?.role === 'STAFF' ? '/admin' : '/member';
}
