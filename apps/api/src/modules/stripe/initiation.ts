/**
 * The one-off charge for joining a co-op (PAY-10).
 *
 * Charley: "Some organizations will need to charge a one-time initiation fee
 * for their memberships. Please add this as an option via Stripe Connect for
 * an admin to pair a one-time fee to a membership subscription, including
 * setting the amount."
 *
 * Pure, and apart from the service, because every expensive mistake available
 * here is a decision rather than an API call: charging somebody twice,
 * charging them for changing tier, or charging them a fee the co-op removed
 * last week.
 */

/**
 * The most a co-op may ask to join, in cents (PAY-10).
 *
 * This was $500, chosen by me as a typo guard and wrong the first time a real
 * co-op used it: MaybeItsFate's Believer level asks $970, and the screen
 * refused it with "initiationFeeCents must not be greater than 50000".
 *
 * A joining fee is not a subscription — it is the price of a place in a
 * building, and co-ops that ask for one often ask for thousands. The guard
 * that matters is against typing cents into a box labelled dollars, and
 * $25,000 catches that while standing well clear of anything a co-op means.
 *
 * Stripe will not take a single charge above $999,999.99, so this is nowhere
 * near a technical limit; it is a question of what is plausibly deliberate.
 */
export const MAX_INITIATION_CENTS = 25_000_00;

export interface InitiationOwed {
  /** What to charge now, in cents. Zero when nothing is owed. */
  cents: number;
  /** Why, for the line on the checkout page and for the tests. */
  reason: 'none' | 'tier-has-no-fee' | 'already-paid' | 'owed';
}

/**
 * What this member owes for joining, right now.
 *
 * **Once per member, not once per tier.** Moving between tiers is not joining
 * again, and a co-op that charged for it would be charging somebody for
 * changing their mind — which is the version of this feature that generates
 * refund requests. A member who has never paid one owes whatever the tier
 * they are joining asks, including somebody moving up from a free tier that
 * asked for nothing.
 */
export function initiationOwed(input: {
  tierInitiationCents: number | null | undefined;
  alreadyPaidAt: Date | null | undefined;
}): InitiationOwed {
  const asked = Math.max(0, Math.trunc(input.tierInitiationCents ?? 0));

  if (asked === 0) return { cents: 0, reason: 'tier-has-no-fee' };
  if (input.alreadyPaidAt) return { cents: 0, reason: 'already-paid' };

  return { cents: asked, reason: 'owed' };
}

/** Whether an amount an admin typed is one we will take. */
export function initiationProblem(cents: number): string | null {
  if (!Number.isInteger(cents)) return 'A joining fee has to be a whole number of cents.';
  if (cents < 0) return 'A joining fee cannot be negative.';
  if (cents > MAX_INITIATION_CENTS) {
    // In dollars, because that is the box the admin typed into.
    return `A joining fee over $${(MAX_INITIATION_CENTS / 100).toLocaleString()} is almost certainly a typo — check whether you meant dollars.`;
  }
  return null;
}

/**
 * What the member is told before they pay.
 *
 * Said in full on the way in, because a one-off charge somebody did not
 * expect is the charge they dispute — and a disputed card payment costs the
 * co-op the fee as well as the money.
 */
export function describeInitiation(cents: number, dues: string): string {
  if (cents <= 0) return dues;
  return `${dues}, plus a one-time ${money(cents)} joining fee`;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
}
