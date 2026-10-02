/**
 * The members MaybeOS has not started billing yet (MIG-03).
 *
 * A co-op migrating in brings its members before it brings its money.
 * MaybeItsFate imported 426 people and every one of them is still charged by
 * the Stripe account they originally signed up through — MaybeOS holds no
 * subscription for any of them. Their Dues & billing page offered a tier to
 * buy and said nothing whatsoever about the money already leaving their
 * account each month, so the question an imported member actually arrives
 * with — "am I about to pay twice?" — had no answer anywhere on it.
 *
 * So: a member MaybeOS is not billing, who is nonetheless on a tier that
 * costs money, is being billed by something else. That is the rule, and it is
 * deliberately not a flag on the membership. A flag has to be set correctly
 * at import and stays wrong forever if it is not; this reads the same two
 * facts the page is already showing, and it **stops being true by itself** —
 * the moment the adoption scan links their real subscription, or they pick a
 * tier here, the link disappears without anybody remembering to remove it.
 */

export interface MembershipLike {
  subscriptionStatus?: string | null;
  tierId?: string | null;
}

export interface TierLike {
  id: string;
  priceMonthly?: number | null;
  isPayWhatYouCan?: boolean;
}

/** Statuses that mean MaybeOS has a live billing relationship with them. */
const BILLED_BY_MAYBEOS = ['ACTIVE', 'TRIALING', 'PAST_DUE', 'UNPAID', 'INCOMPLETE'];

export function billedElsewhere(
  membership: MembershipLike | null | undefined,
  tiers: TierLike[] | null | undefined,
  legacyBillingUrl: string | null | undefined,
): boolean {
  // Nothing to point at. A co-op that started on MaybeOS has no previous
  // billing and must not be shown a link to one.
  if (!legacyBillingUrl?.trim()) return false;
  if (!membership) return false;

  const status = (membership.subscriptionStatus ?? 'NONE').toUpperCase();
  if (BILLED_BY_MAYBEOS.includes(status)) return false;

  // A tier that costs nothing is not evidence of billing anywhere. The $0
  // members of a co-op are the single largest group in MaybeItsFate's roster,
  // and telling a hundred people who pay nothing to go and manage a payment
  // is worse than telling them nothing.
  const tier = tiers?.find((t) => t.id === membership.tierId);
  if (!tier) return false;

  return tier.isPayWhatYouCan === true || (tier.priceMonthly ?? 0) > 0;
}
