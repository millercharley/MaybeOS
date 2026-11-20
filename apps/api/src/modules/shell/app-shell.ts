import { settleBundle, type Bundle, type BundleFailure } from '../../common/bundle';

/**
 * What the app shell asks for, in one request (OPS-47).
 *
 * OPS-46 took the member dashboard from sixteen requests to six and left five
 * of those six on its own card, because they are not the dashboard's — they
 * belong to the chrome every signed-in page renders:
 *
 *   auth/profile   onboarding/me   unread   links   welcome/outstanding
 *
 * Four of the five are org-scoped and fire together, from four providers
 * mounted side by side in `app/(app)/layout.tsx`, on the same two values
 * (`token`, `currentOrgId`). They are four requests asking one question —
 * "what does the chrome need for this member in this co-op" — and they are
 * paid on *every* page, not just the dashboard. In production `/api/*` is
 * same-origin, so four requests are four Netlify Function invocations on
 * Micro compute, per page, per member.
 *
 * `auth/profile` is the fifth and stays separate, for a reason rather than an
 * oversight: it is what establishes *which* co-op, so it cannot be inside a
 * route scoped to one. Two is the floor here, and this takes the shell from
 * five to two.
 *
 * What is deliberately *not* folded in is the dashboard's own bundle. The
 * shell is every page; `member-home` is one page and much heavier. Merging
 * them would make every screen in the product pay for the dashboard's ten
 * sections.
 *
 * ## Why these four and not a cache
 *
 * Three of the four change rarely — the checklist, the co-op's links, the
 * outstanding reading. The tempting fix is to cache them client-side and skip
 * the request. That trades a known cost for an unknown one: a stale checklist
 * or a stale reading gate is a member told to read something they have read,
 * or not told about something they have not, and neither failure announces
 * itself. One cheap request that is always right beats four expensive ones
 * and a cache nobody can see into.
 *
 * `unread` is the exception that proves it: it is genuinely live, polls on a
 * minute with backoff, and keeps its own timer. This bundle only saves it its
 * *first* request — the poll is untouched.
 */
export const SHELL_SECTIONS = ['unread', 'onboarding', 'links', 'reading'] as const;

export type ShellSection = (typeof SHELL_SECTIONS)[number];

export type AppShell<T = unknown> = Bundle<ShellSection, T>;

export type ShellFailure = BundleFailure<ShellSection>;

/**
 * Settles, for the same reason the dashboard does.
 *
 * The four providers this replaces each failed alone: a hiccup fetching the
 * co-op's links left the badge, the checklist and the reading gate working.
 * `Promise.all` would make one failing query blank the chrome of every page
 * in the product at once — which is worse than the fan-out it replaces, and
 * on the shell it is worse than on the dashboard, because there is no page
 * left to read. A source scan refuses `Promise.all` in the service.
 */
export function settleShell<T>(
  names: readonly ShellSection[],
  results: PromiseSettledResult<T>[],
): { sections: AppShell<T>; failed: ShellFailure[] } {
  return settleBundle(names, results);
}

export { isUnavailable } from '../../common/bundle';
