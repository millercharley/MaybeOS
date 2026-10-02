/**
 * A status an organiser sets by hand (MEM-23).
 *
 * `subscriptionStatus` has only ever meant "what Stripe last said". That
 * stopped covering the membership the moment co-ops arrived with members who
 * pay nothing and members who pay elsewhere: MaybeItsFate has 110 people on a
 * $0 tier who will never have a Stripe subscription, and every one of them
 * read "Not set up" on their own billing page and showed as NONE in the
 * admin roster — which is a sentence about Stripe being asked to stand in for
 * a sentence about whether somebody is a member.
 *
 * So an organiser can set it — **but only where Stripe is not already
 * answering**. A manual status on a membership Stripe bills is worse than no
 * manual status at all: it is overwritten by the next webhook, so it tells
 * the truth until it silently does not, and in between it is the screen an
 * organiser trusts.
 */

/** What an organiser may choose. */
export const MANUAL_STATUSES = ['ACTIVE', 'PAST_DUE', 'CANCELED', 'NONE'] as const;

export type ManualStatus = (typeof MANUAL_STATUSES)[number];

export function isManualStatus(value: string): value is ManualStatus {
  return (MANUAL_STATUSES as readonly string[]).includes(value);
}

/**
 * Why a membership's status cannot be set by hand, or null when it can.
 *
 * A sentence rather than a boolean, because the answer is the whole point:
 * an organiser looking at a member they cannot edit wants to know who is
 * deciding instead, and "Stripe" is a better answer than a disabled control.
 */
export function manualStatusRefusal(membership: {
  stripeSubscriptionId: string | null;
}): string | null {
  if (membership.stripeSubscriptionId) {
    return (
      'Stripe is billing this member, so their status follows their subscription. ' +
      'Change it in Stripe, or cancel their dues, and MaybeOS will follow.'
    );
  }

  return null;
}
