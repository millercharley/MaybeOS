/**
 * Showing a member where the product is, once, on a phone (NAV-05).
 *
 * On a laptop the navigation is simply there — a dark column down the left,
 * every section visible without being asked for. Below `lg` the same column
 * becomes a drawer behind a hamburger, and the product's entire contents go
 * with it. A member who has only ever opened MaybeOS on a phone has seen a
 * dashboard and a back button.
 *
 * Charley, 2026-11-13, after the door went live: members could not find their
 * door code. The code was never hidden — it is at the top of My Profile — but
 * My Profile is inside a collapsed section inside a drawer behind an icon, and
 * three closed doors is the same as a locked one.
 *
 * So: two beats, each said once and then never again.
 *
 *   `menu`       point at the hamburger
 *   `membership` once it is open, light up the section their own things are in
 *   `done`       nothing, for good
 *
 * **Device-local, deliberately.** This is localStorage rather than a column on
 * the membership because what it records is "this browser has been shown the
 * drawer", and that is a fact about the device, not about the person. Somebody
 * who uses MaybeOS on a laptop and then opens it on a phone for the first time
 * is a first-time phone user and should get the tour. The cost is that a
 * member with two phones is shown it twice, which is the right way round.
 *
 * A member who never finishes the tour is never nagged either: the second beat
 * only draws inside a drawer they chose to open.
 */

const STORED = 'maybeos.nav-coach';

export type CoachStep = 'menu' | 'membership' | 'done';

/**
 * Where this browser has got to.
 *
 * Anything unrecognised — a value from an older build, a key somebody edited
 * by hand — reads as the beginning rather than as an error. The worst case is
 * one more tour.
 */
export function readCoach(): CoachStep {
  if (typeof window === 'undefined') return 'done';
  try {
    const saved = window.localStorage.getItem(STORED);
    return saved === 'membership' || saved === 'done' ? saved : 'menu';
  } catch {
    /*
      Private windows and blocked storage both throw on read. A tour is not
      worth a crash on the shell that every signed-in page renders inside, and
      `done` is the safe answer: showing nothing is a worse first run, showing
      it on every single page load is a broken product.
    */
    return 'done';
  }
}

/** Move the tour on. Writing is best-effort for the same reason reading is. */
export function setCoach(step: CoachStep): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORED, step);
  } catch {
    // See `readCoach`. The tour simply repeats on the next load.
  }
}

/**
 * Whether an address means the member has arrived somewhere in My membership,
 * which is the tour finding its own ending.
 *
 * The section holds `/member/<slug>/<page>` — events, bookings, service,
 * billing, impact, profile, settings. The dashboard at `/member/<slug>` is
 * hoisted out of the section and sits above it, so it must *not* count:
 * landing on the dashboard is where the tour starts, not where it finishes.
 *
 * Pure, and separate from the storage above, so the rule can be read and
 * tested without a browser.
 */
export function reachedMembership(pathname: string | null | undefined): boolean {
  return /^\/member\/[^/]+\/[^/]+/.test(pathname ?? '');
}
