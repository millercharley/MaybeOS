/**
 * How often MaybeOS asks a member what they are interested in (RDR-01).
 *
 * Modelled on ImpactOS's `ask-budget.ts` and deliberately **separate from
 * it**. D-021's budget exists because impact questions take something from a
 * member and give them nothing back; spending that budget here would silence
 * a co-op's measurement for a month in order to ask somebody whether they
 * like board games. This question is the member configuring something for
 * their own benefit, and it earns its own, narrower allowance.
 *
 * Where it is stricter than the impact budget: three dismissals and MaybeOS
 * stops asking altogether, with no annual fallback. Impact has a reason to
 * come back once a year — a co-op's funders ask it to. Radar does not: a
 * member who has waved this away three times has told us what they think of
 * it, and the interests editor in their profile is always there if they
 * change their mind.
 */

/** Days between asks, widening with each dismissal. */
const WINDOW_DAYS = [21, 45, 90];

/** After this many dismissals, MaybeOS stops asking. */
export const DISMISSALS_UNTIL_SILENT = WINDOW_DAYS.length;

/** How many interests to offer at once — Charley's "3 or 4 to look at". */
export const INTERESTS_PER_ASK = 4;

export interface InterestAskState {
  interestsAskedAt: Date | null;
  interestsDismissals: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function windowDaysFor(dismissals: number): number | null {
  if (dismissals >= DISMISSALS_UNTIL_SILENT) return null;
  return WINDOW_DAYS[Math.max(0, dismissals)];
}

/** When the next ask becomes allowed, or null if MaybeOS has stopped asking. */
export function nextAskAllowedAt(state: InterestAskState): Date | null {
  const days = windowDaysFor(state.interestsDismissals);
  if (days === null) return null;
  if (!state.interestsAskedAt) return new Date(0);
  return new Date(state.interestsAskedAt.getTime() + days * DAY_MS);
}

export function canAskInterests(state: InterestAskState, now: Date = new Date()): boolean {
  const allowedAt = nextAskAllowedAt(state);
  return allowedAt !== null && now.getTime() >= allowedAt.getTime();
}

/** Answering resets the clock and forgives the dismissals that came before. */
export function afterAnswer(now: Date = new Date()): InterestAskState {
  return { interestsAskedAt: now, interestsDismissals: 0 };
}

/** Waving it away widens the gap, and three of them end it. */
export function afterDismissal(
  state: InterestAskState,
  now: Date = new Date(),
): InterestAskState {
  return { interestsAskedAt: now, interestsDismissals: state.interestsDismissals + 1 };
}
