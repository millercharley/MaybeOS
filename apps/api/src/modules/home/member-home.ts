/**
 * What the member dashboard asks for, in one request (OPS-46).
 *
 * The dashboard fanned out to sixteen requests on every load. Measured on a
 * production build of the web app against the dev API on 2026-11-19 —
 * `next dev` could not answer the question, because StrictMode invokes every
 * effect twice and inflates the count:
 *
 *   auth/profile ×2   onboarding/me   unread   links   welcome/outstanding
 *   my-service   recent-joins   door/pin   teaching   radar/ask
 *   members/spotlight   my-bookings   events/my-rsvps   events/visible
 *   member-stats
 *
 * Ten of those sixteen belong to this page and nothing else. In production
 * `/api/*` is same-origin (`NEXT_PUBLIC_API_URL` is maybeos.org), so there are
 * no CORS preflights and ten requests mean ten Netlify Function invocations,
 * on Micro compute, every time a member opens the app's front door.
 *
 * Charley ruled out buying the way out of this — on `ops-compute`: "Moving off
 * Micro compute won't fix the issues, based on what I read about Netlify.
 * Better to make our code more efficient."
 *
 * It had already cost something. D-046 records fifteen Sentry
 * issues and 195 reports in a month, 94% from phones, four endpoints filing
 * four issues *in the same second* from one member — because a dashboard
 * firing its requests in parallel has every one of them killed at once when a
 * phone locks. Fewer requests is the only fix for that which does not involve
 * guessing at the browser's intent.
 *
 * This file holds the part that is a decision rather than a query: which
 * sections exist, and what happens when one of them fails.
 */

/**
 * The sections of a member's dashboard, named once.
 *
 * The API's response and the web app's type both have to agree about these,
 * and nothing in the compiler connects the two across the workspace boundary.
 * So the list is a constant with a test that pins it, and a section added on
 * one side without the other fails a test rather than rendering an empty
 * panel in production.
 */
import { settleBundle, type Bundle, type BundleFailure } from '../../common/bundle';

export const MEMBER_HOME_SECTIONS = [
  'stats',
  'joins',
  'bookings',
  'rsvps',
  'events',
  'spotlight',
  'doorPin',
  'teaching',
  'service',
  'ask',
] as const;

export type SectionName = (typeof MEMBER_HOME_SECTIONS)[number];

export type MemberHome<T = unknown> = Bundle<SectionName, T>;

export type SectionFailure = BundleFailure<SectionName>;

/**
 * One section failing must not empty the page.
 *
 * This is the whole reason the bundle settles rather than awaiting. Ten
 * separate requests had one accidental virtue: a panel whose request failed
 * drew nothing and the other nine were unaffected — DECISIONS.md says so
 * outright about the Sentry cluster, "nothing was broken for anybody:
 * `loadProfile` keeps the token, the badge keeps its last value, the panel
 * renders nothing."
 *
 * `Promise.all` would have thrown that away: a single failing query — one
 * co-op with a door integration down, one malformed row — would answer 500
 * for the entire dashboard. That is strictly worse than the fan-out it
 * replaces, and it is the trap this function exists to avoid.
 *
 * The machinery moved to `common/bundle.ts` when the app shell needed the
 * same thing (OPS-47); this stays as the dashboard's own name for it so the
 * call sites and their tests read as they did. What is *not* shared is the
 * list of sections above — that is this page's decision and nobody else's.
 */
export function settleSections<T>(
  names: readonly SectionName[],
  results: PromiseSettledResult<T>[],
): { sections: MemberHome<T>; failed: SectionFailure[] } {
  return settleBundle(names, results);
}

/**
 * A section refused because this co-op does not use the feature.
 *
 * Teaching is the one that found this. `teaching.listForOrg` calls
 * `requireEnabled`, which throws `Forbidden` when a co-op has the feature
 * switched off — and most co-ops do. Settled into the bundle that reads as a
 * failed section, which is *correct* for the panel (it draws nothing either
 * way, and the web side gates on the co-op's own switch) but wrong for the
 * log: it would have written a warning on every dashboard load of every co-op
 * not using teaching, which is precisely the noise D-046 was written about.
 *
 * So a 403 from a composed section means "not here", not "broken".
 */
export { isUnavailable } from '../../common/bundle';
