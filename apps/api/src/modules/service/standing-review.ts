/**
 * When a standing duty is due a look (SRV-04).
 *
 * Charley, 2026-09-09: "Duties go stale after 6 months."
 *
 * The failure mode of a standing arrangement is not somebody dropping it —
 * that is visible the week it happens. It is the arrangement quietly ceasing
 * to suit the person holding it while nobody asks. Six months is the interval
 * he chose; it lives here as one number rather than in a query, because a
 * threshold buried in a `where` clause is a threshold nobody can find to argue
 * with.
 *
 * Derived, not stored: a row does not become stale by being written to, it
 * becomes stale by time passing, and a stored flag would need a job to keep
 * it true. The same argument as the onboarding checklist's completion.
 */
export const STANDING_DUTY_REVIEW_MONTHS = 6;

/** The clock starts at the last review, or at adoption if there has never been one. */
export function lastLookedAt(adoption: {
  startedAt: Date;
  reviewedAt: Date | null;
}): Date {
  return adoption.reviewedAt ?? adoption.startedAt;
}

/** When this arrangement next needs a look. */
export function reviewDueAt(adoption: { startedAt: Date; reviewedAt: Date | null }): Date {
  const from = lastLookedAt(adoption);
  const due = new Date(from);
  due.setMonth(due.getMonth() + STANDING_DUTY_REVIEW_MONTHS);
  return due;
}

/**
 * Whether it is overdue.
 *
 * `now` is a parameter so the boundary can be tested rather than waited for —
 * six months is not something a test can sit through.
 */
export function needsReview(
  adoption: { startedAt: Date; reviewedAt: Date | null },
  now: Date = new Date(),
): boolean {
  return reviewDueAt(adoption).getTime() <= now.getTime();
}
