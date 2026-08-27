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

/**
 * The prices billed **per member**, where `quantity` is the member count
 * (PLT-03).
 *
 * A deliberate allowlist rather than "anything on the Plus product", because
 * getting this wrong is not a rounding error. **Unlimited is $349 flat.**
 * Setting a quantity of 300 on it would invoice a co-op $104,700, and Stripe
 * would be right to do it — the mistake would be entirely ours. So quantity is
 * only ever set on a price named here, and every other plan is left at 1.
 *
 * Charley's call, 2026-08-20: **snapshot at renewal**, so a co-op gets one
 * predictable bill rather than a stream of proration lines, and **GUEST
 * memberships are excluded** — a guest is not a member.
 */
export const PER_MEMBER_PRICE_IDS = new Set<string>([
  'price_1U6M1VD14bhghVE2lprg1qo0', // MaybeOS Plus — $0.50 per member / month
  // The yearly Plus price is being reissued as a *licensed* price: the
  // original was metered, which is the wrong model for membership — members
  // are a level, not an event stream, and a metered price with nothing
  // reported bills zero, which is what it has been doing. Its id goes here
  // once it exists.
]);

/** Whether a subscription bills by member count, and so needs a quantity. */
export function billsPerMember(priceIds: string[]): boolean {
  return priceIds.some((id) => PER_MEMBER_PRICE_IDS.has(id));
}
