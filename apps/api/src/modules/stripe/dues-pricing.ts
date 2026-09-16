import { MaybeOsPlan } from '@prisma/client';

/**
 * What MaybeOS adds to a member's dues, by the co-op's plan (PAY-09).
 *
 * Charley, 2026-09-15: on Free, $2.00 per dues payment, **added on top** for
 * the member, the same way the ticket fee is. A member on $10 dues pays $12 and
 * the co-op receives $10, less Stripe's processing. Plus and Unlimited add
 * nothing to dues.
 *
 * Only when a co-op actually charges dues: a $0 tier is not a dues payment,
 * and a member who owes nothing is not charged a fee for owing it.
 */
export const DUES_FEE_CENTS: Record<MaybeOsPlan, number> = {
  FREE: 200,
  PLUS: 0,
  UNLIMITED: 0,
};

/**
 * Members a co-op on Free may have. Guests are not counted, matching how Plus
 * counts members for billing.
 *
 * Charley set this at 100 on 2026-09-15 and raised it to 1,000 the next day.
 */
export const FREE_PLAN_MEMBER_LIMIT = 1000;

export function duesFeeFor(plan: MaybeOsPlan, duesCents: number): number {
  return duesCents > 0 ? DUES_FEE_CENTS[plan] : 0;
}

/**
 * The application fee percentage that takes the flat fee out of an invoice
 * of dues plus fee.
 *
 * A percentage because Stripe subscriptions only take a platform's cut as a
 * percentage of each invoice. Rounded to the two decimals Stripe accepts,
 * which lands within a cent of the flat fee for dues up to $200; `feeFromPercent`
 * is what the spec checks that against.
 */
export function applicationFeePercent(duesCents: number, feeCents: number): number {
  if (feeCents <= 0) return 0;
  return Math.round((feeCents / (duesCents + feeCents)) * 100 * 100) / 100;
}

/** What Stripe takes from an invoice at a given percentage. */
export function feeFromPercent(invoiceCents: number, percent: number): number {
  return Math.round((invoiceCents * percent) / 100);
}
