import { PLAN_BY_PRICE_ID, planForSubscriptionItems } from '../maybeos-plans';
import { PLATFORM_FEE_CENTS } from '../ticket-pricing';

/**
 * Which Stripe price grants which MaybeOS plan (PLT-02).
 *
 * A co-op subscribes through Stripe's hosted pricing table, so all that comes
 * back is a price id. Get this wrong and a co-op pays for Unlimited while its
 * buyers are still charged Free's $1.00 a ticket — or worse, an unrecognised
 * price silently grants the cheapest transaction fee MaybeOS offers.
 */
describe('MaybeOS plan prices', () => {
  it('covers every plan the fee table charges for', () => {
    const granted = new Set(Object.values(PLAN_BY_PRICE_ID));

    for (const plan of Object.keys(PLATFORM_FEE_CENTS)) {
      expect([...granted]).toContain(plan);
    }
  });

  it('maps the live prices read from the account on 2026-08-21', () => {
    expect(PLAN_BY_PRICE_ID.price_1U6M1VD14bhghVE2lprg1qo0).toBe('PLUS'); // $0.50/member/mo
    expect(PLAN_BY_PRICE_ID.price_1U6FNXD14bhghVE2xTrj9hFm).toBe('PLUS'); // $3.65/member/yr
    expect(PLAN_BY_PRICE_ID.price_1U6LvpD14bhghVE2Grl0L9DI).toBe('UNLIMITED'); // $349/mo
    expect(PLAN_BY_PRICE_ID.price_1U6LSOD14bhghVE2SmwvrD1d).toBe('UNLIMITED'); // $3,588/yr
  });

  describe('resolving a subscription', () => {
    it('returns null for a price nobody recognises', () => {
      // Never guessed. Guessing upward hands out UNLIMITED for an unknown
      // price; guessing downward charges a paying co-op Free's fee.
      expect(planForSubscriptionItems(['price_not_ours'])).toBeNull();
      expect(planForSubscriptionItems([])).toBeNull();
    });

    it('ignores unknown prices sitting beside a known one', () => {
      expect(
        planForSubscriptionItems(['price_not_ours', 'price_1U6LvpD14bhghVE2Grl0L9DI']),
      ).toBe('UNLIMITED');
    });

    it('takes the highest plan when a subscription somehow carries two', () => {
      // Resolving downward would charge for Unlimited while billing the
      // co-op's members Free's transaction fee.
      expect(
        planForSubscriptionItems([
          'price_1U6M1vD14bhghVE2WEDgNnmV', // Free
          'price_1U6M1VD14bhghVE2lprg1qo0', // Plus
        ]),
      ).toBe('PLUS');
    });
  });

  it('is worth having: the plans really do charge different fees', () => {
    // If these were equal the mapping would be decoration rather than money.
    expect(PLATFORM_FEE_CENTS.FREE).not.toBe(PLATFORM_FEE_CENTS.UNLIMITED);
  });
});
