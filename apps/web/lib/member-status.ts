/**
 * A status an organiser sets by hand (MEM-23).
 *
 * `subscriptionStatus` has only ever meant "what Stripe last said", and that
 * stopped covering the membership once co-ops arrived with members who pay
 * nothing. MaybeItsFate has 110 people on a $0 tier who will never have a
 * Stripe subscription: every one showed as NONE in the roster and read "Not
 * set up" on their own billing page — Stripe being asked to answer a question
 * about whether somebody is a member.
 */

export const MANUAL_STATUSES = ['ACTIVE', 'PAST_DUE', 'CANCELED', 'NONE'] as const;

/** What each status is called where an organiser reads it. */
export const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  PAST_DUE: 'Past due',
  CANCELED: 'Cancelled',
  NONE: 'Not set up',
  TRIALING: 'Trialling',
  UNPAID: 'Unpaid',
  INCOMPLETE: 'Incomplete',
};

/**
 * Whether an organiser may set this member's status.
 *
 * False where Stripe is billing them, because a manual status there is
 * overwritten by the next webhook — right until it silently is not, and in
 * between it is the screen an organiser trusts. The API refuses it too; this
 * keeps a control that cannot work off the page.
 */
export function canSetStatus(member: { stripeSubscriptionId?: string | null }): boolean {
  return !member.stripeSubscriptionId;
}

/** Why it cannot be changed here, for the organiser looking at it. */
export const STRIPE_OWNS_IT =
  'Stripe is billing this member, so their status follows their subscription.';
