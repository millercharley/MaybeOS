/**
 * Which portal addresses a signed-out visitor may reach (2026-09-04).
 *
 * Charley: signing out must block pages like `/portal/maybeitsfate/rooms` and
 * send you to the login screen. The portal was built with no session check at
 * all — the co-op is fetched by slug without a token, so the whole shell
 * rendered for anybody, and every page inside it then asked the API for real
 * data and got 401s. What a signed-out visitor saw was a co-op's private space
 * with everything in it failing.
 *
 * But the portal is not uniformly private, and a blanket guard would have
 * broken the two things that are meant to travel:
 *
 * - **A public event's page.** `/portal/:slug/events/:eventSlug` is where a
 *   link shared on social lands, and where somebody who is not a member buys
 *   a ticket. Charley's rule: event links can be public for people to RSVP and
 *   buy tickets. The events list is the same page one level up, and the co-op's
 *   own public page links to it.
 * - **A published impact report.** `/portal/:slug/reports/:reportSlug` is the
 *   one public page in ImpactOS — a report a co-op cannot send to a funder is
 *   not a report.
 *
 * Neither leaks anything by being open: both are served by endpoints that
 * decide for themselves what an anonymous caller gets. A members-only event
 * 404s to the public read, and a report is generated with the suppression
 * threshold already applied. This function does not grant access — the API
 * does that — it only decides whether to send somebody to the login screen
 * before they arrive.
 *
 * An allowlist rather than a blocklist, so a portal section added later is
 * private until somebody deliberately opens it. That is the direction a
 * mistake should fail in.
 */
const PUBLIC_PORTAL_SECTIONS = new Set(['events', 'reports']);

/**
 * True when `pathname` is a portal address that a signed-out visitor should be
 * redirected away from. False for anything outside `/portal`, and for the
 * public sections above.
 */
export function portalRequiresAuth(pathname: string | null | undefined): boolean {
  if (!pathname) return false;

  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'portal') return false;

  // `/portal` and `/portal/:orgSlug` — the co-op's own front door, inside.
  if (segments.length < 3) return true;

  return !PUBLIC_PORTAL_SECTIONS.has(segments[2]);
}
