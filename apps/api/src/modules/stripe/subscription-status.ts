/**
 * Stripe's word for a subscription, in MaybeOS's vocabulary.
 *
 * One copy, because there were three and they disagreed. Two mapped four
 * statuses; a third mapped seven and fell back to `NONE` — so `unpaid` meant
 * PAST_DUE down one path and "never subscribed" down another, and the same
 * event could leave a membership in different states depending on which
 * function happened to see it. That third one had no callers, which is the
 * only reason it never happened. It has been deleted; this is what remains.
 *
 * **Null means Stripe said something this product has no word for.** Callers
 * leave the stored status alone rather than guessing (PLT-07): `unpaid` and
 * `incomplete_expired` are real Stripe states, and overwriting a membership
 * with a wrong word is worse than leaving a stale right one.
 */
export type MembershipSubscriptionStatus =
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'TRIALING';

const STRIPE_TO_MEMBERSHIP: Record<string, MembershipSubscriptionStatus> = {
  active: 'ACTIVE',
  past_due: 'PAST_DUE',
  canceled: 'CANCELED',
  trialing: 'TRIALING',
};

export function membershipStatusFor(
  stripeStatus: string,
): MembershipSubscriptionStatus | null {
  return STRIPE_TO_MEMBERSHIP[stripeStatus] ?? null;
}
