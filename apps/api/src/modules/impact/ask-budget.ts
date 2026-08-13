/**
 * The fatigue budget (D-021, PRD §6.2).
 *
 * D-021 calls this the load-bearing constraint of ImpactOS, above the AI and
 * above the schema: *"Response rate is the binding constraint on the whole
 * product; a plan that burns member goodwill in month two has no report in
 * month twelve."*
 *
 * The rule it records: one micro-question per member per 30 days **across all
 * touchpoints**, roughly twelve a year, with dismissal extending that member's
 * window and three dismissals moving them to an annual check-in only — with no
 * admin override.
 *
 * Kept as a pure function with no database and no clock of its own, because it
 * is the one piece of ImpactOS that must be provably right. Everything else
 * shows a number; this decides whether a member is asked at all.
 */

/** Days between asks, by how many times this member has dismissed one. */
const WINDOW_DAYS = [30, 60, 90];

/** Three dismissals and MaybeOS stops asking except once a year. */
export const DISMISSALS_UNTIL_ANNUAL = 3;
export const ANNUAL_WINDOW_DAYS = 365;

const DAY_MS = 86_400_000;

export interface AskState {
  /** When this member was last asked anything, at any touchpoint. */
  lastAskedAt: Date | null;
  /** How many asks they have dismissed. */
  askDismissals: number;
}

/**
 * How long this member's window currently is, in days.
 *
 * Dismissal widens it rather than merely resetting it: somebody declining is
 * saying something, and asking them again on the same cadence answers "no" by
 * repeating the question.
 */
export function windowDaysFor(askDismissals: number): number {
  if (askDismissals >= DISMISSALS_UNTIL_ANNUAL) return ANNUAL_WINDOW_DAYS;
  return WINDOW_DAYS[Math.max(0, askDismissals)] ?? WINDOW_DAYS[WINDOW_DAYS.length - 1];
}

/** The earliest this member may be asked again. Null means "any time now". */
export function nextAskAllowedAt(state: AskState): Date | null {
  if (!state.lastAskedAt) return null;
  return new Date(state.lastAskedAt.getTime() + windowDaysFor(state.askDismissals) * DAY_MS);
}

/**
 * May this member be asked a question right now?
 *
 * Deliberately has no `force` or `override` parameter. D-021 says the annual
 * fallback has no admin override, and a flag here is how that becomes one.
 */
export function canAsk(state: AskState, now: Date = new Date()): boolean {
  const allowedAt = nextAskAllowedAt(state);
  return allowedAt === null || now.getTime() >= allowedAt.getTime();
}

/**
 * A member's state after they answer.
 *
 * Answering does not clear dismissals. Somebody who has declined twice and
 * then answers is still somebody who has declined twice, and resetting the
 * count would let a member be walked back to the 30-day cadence they had
 * already pushed away from.
 */
export function afterAnswer(state: AskState, now: Date = new Date()): AskState {
  return { lastAskedAt: now, askDismissals: state.askDismissals };
}

/** A member's state after they dismiss one. */
export function afterDismissal(state: AskState, now: Date = new Date()): AskState {
  return { lastAskedAt: now, askDismissals: state.askDismissals + 1 };
}

/**
 * Roughly how many asks a member sees in a year at their current cadence —
 * the number the PRD's "~12 a year" is a claim about, so it is worth being
 * able to state rather than assume.
 */
export function asksPerYear(askDismissals: number): number {
  return Math.floor(365 / windowDaysFor(askDismissals));
}
