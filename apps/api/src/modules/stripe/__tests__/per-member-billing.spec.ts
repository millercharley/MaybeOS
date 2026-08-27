import { PER_MEMBER_PRICE_IDS, billsPerMember, PLAN_BY_PRICE_ID } from '../maybeos-plans';

/**
 * Billing MaybeOS Plus by member count (PLT-03).
 *
 * The test that matters is the one about what *never* gets a quantity.
 * Unlimited is $349 flat: a quantity of 300 on it would invoice a co-op
 * $104,700, Stripe would be right to do it, and the mistake would be entirely
 * ours. Everything else here is arithmetic; that one is money.
 */
describe('per-member prices', () => {
  it('never treats a flat price as per-member', () => {
    const flat = [
      'price_1U6LvpD14bhghVE2Grl0L9DI', // Unlimited $349 / month
      'price_1U6LSOD14bhghVE2SmwvrD1d', // Unlimited $3,588 / year
      'price_1U6M1vD14bhghVE2WEDgNnmV', // Free $0 / month
      'price_1U6M2iD14bhghVE2VMPWxmQp', // Free $0 / year
    ];

    for (const id of flat) {
      expect(PER_MEMBER_PRICE_IDS.has(id)).toBe(false);
      expect(billsPerMember([id])).toBe(false);
    }
  });

  it('recognises the Plus monthly price', () => {
    expect(billsPerMember(['price_1U6M1VD14bhghVE2lprg1qo0'])).toBe(true);
  });

  it('is an allowlist, not a guess about the Plus product', () => {
    // "Anything on the Plus product" would have swept in a future flat price
    // and billed it by the member.
    expect(billsPerMember(['price_not_ours'])).toBe(false);
    expect(billsPerMember([])).toBe(false);
  });

  it('spots a per-member price sitting beside a flat one', () => {
    expect(
      billsPerMember(['price_1U6LvpD14bhghVE2Grl0L9DI', 'price_1U6M1VD14bhghVE2lprg1qo0']),
    ).toBe(true);
  });

  it('every per-member price is a price we already recognise', () => {
    // A price that bills per member but grants no plan would take a co-op's
    // money and leave it on FREE.
    for (const id of PER_MEMBER_PRICE_IDS) {
      expect(PLAN_BY_PRICE_ID[id]).toBeDefined();
    }
  });

  it('does not yet include the yearly Plus price', () => {
    // Deliberate, and this test is the reminder. The original yearly price is
    // metered — the wrong model for membership, and it bills zero because
    // nothing is ever reported. Charley is reissuing it as licensed; its id
    // goes in when it exists, and this expectation flips.
    expect(PER_MEMBER_PRICE_IDS.has('price_1U6FNXD14bhghVE2xTrj9hFm')).toBe(false);
    expect(PER_MEMBER_PRICE_IDS.size).toBe(1);
  });
});
