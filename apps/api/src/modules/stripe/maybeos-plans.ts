import { MaybeOsPlan } from '@prisma/client';

/**
 * Which Stripe price means which MaybeOS plan (PLT-02).
 *
 * A co-op subscribes through Stripe's hosted pricing table, so what comes back
 * is a price id and nothing else. Without this map a co-op can pay MaybeOS and
 * stay on FREE — still charged $1.00 a ticket while paying for a plan that
 * charges $0.10.
 *
 * Read from the live account on 2026-08-21. Ids rather than amounts on
 * purpose: a price's amount can be changed in Stripe and its id cannot, so
 * matching on the id is the thing that stays true when Charley reprices.
 *
 * Unknown ids resolve to `null` and are logged rather than guessed. Guessing
 * would mean an unrecognised subscription silently granting UNLIMITED.
 */
export const PLAN_BY_PRICE_ID: Record<string, MaybeOsPlan> = {
  // MaybeOS Free — prod_V6YgIe23CWAA5M
  price_1U6M1vD14bhghVE2WEDgNnmV: 'FREE', // $0 / month
  price_1U6M2iD14bhghVE2VMPWxmQp: 'FREE', // $0 / year
  price_1U6LZ3D14bhghVE29XZUY44x: 'FREE', // $0 one-time

  // MaybeOS Plus — prod_V6SI9a0RfuTulm
  price_1U6M1VD14bhghVE2lprg1qo0: 'PLUS', // $0.50 per member / month
  price_1U6FNXD14bhghVE2xTrj9hFm: 'PLUS', // $3.65 per member / year, metered

  // MaybeOS Unlimited — prod_V6YZST1JiLzsFB
  price_1U6LvpD14bhghVE2Grl0L9DI: 'UNLIMITED', // $349 / month
  price_1U6LSOD14bhghVE2SmwvrD1d: 'UNLIMITED', // $3,588 / year
};

/**
 * The plan a subscription grants, or null if nothing here recognises it.
 *
 * Takes the **highest** plan among the subscription's items rather than the
 * first. A subscription carrying more than one MaybeOS price is not expected,
 * and if one ever appears, resolving it downward would quietly charge a co-op
 * for Unlimited while billing its members Free's transaction fee.
 */
export function planForSubscriptionItems(priceIds: string[]): MaybeOsPlan | null {
  const rank: Record<MaybeOsPlan, number> = { FREE: 0, PLUS: 1, UNLIMITED: 2 };

  const plans = priceIds
    .map((id) => PLAN_BY_PRICE_ID[id])
    .filter((plan): plan is MaybeOsPlan => Boolean(plan));

  if (plans.length === 0) return null;

  return plans.reduce((best, plan) => (rank[plan] > rank[best] ? plan : best));
}
