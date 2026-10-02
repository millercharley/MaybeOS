/**
 * What removing a member costs them (MEM-20).
 *
 * The removal cancels dues immediately rather than at the end of the period,
 * and Stripe does not refund the days already paid for. An organiser clicking
 * "remove" to tidy up a roster is not expecting to take money off somebody,
 * so the warning has to appear for exactly the people it applies to — and not
 * for the ones it does not, because a warning that fires on everybody stops
 * being read.
 */

/** Subscription states where Stripe would still charge them again. */
const LIVE_DUES = ['ACTIVE', 'TRIALING', 'PAST_DUE', 'UNPAID', 'INCOMPLETE'];

export function payingDues(member: { subscriptionStatus?: string | null }): boolean {
  const status = member.subscriptionStatus;
  if (!status) return false;
  return LIVE_DUES.includes(status.toUpperCase());
}
