import type { UserProfile } from './api';

/**
 * Where a person belongs immediately after signing in.
 *
 * Both sign-in paths used to hard-code `/admin`, so every member who signed
 * in — by password or by magic link — landed on "This page is for organisers"
 * and had to notice the small link back to their own dashboard. The gate
 * itself was right; sending them at it was not.
 *
 * **Everybody lands on their own dashboard now, organiser or not** (Charley,
 * 2026-10-02), which follows the nav: the main Dashboard is the member's
 * dashboard for everyone, and Administration is a section an organiser goes
 * to rather than the place they are put. Signing in and arriving at the
 * admin screens told every organiser their co-op was a thing to run before
 * it was a thing to belong to.
 *
 * Safe against the loop this function's comment used to warn about: only
 * `/admin` is gated (`OrganiserOnly` in the dashboard layout), and `/member`
 * refuses nobody who is a member — which an organiser is.
 */
export function landingPathFor(
  user: Pick<UserProfile, 'orgs' | 'globalRole'>,
  _currentOrgId?: string | null,
): string {
  // MaybeOS's own operators, whose home is the console rather than any one
  // co-op's member page.
  if (user.globalRole === 'PLATFORM_ADMIN') {
    return '/admin';
  }

  return '/member';
}
