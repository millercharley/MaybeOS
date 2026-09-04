import { PUBLIC_TIER_SELECT } from '../tier-view';

/**
 * What a stranger gets when they ask a co-op for its tiers (MEM-14).
 *
 * `GET /orgs/:orgId/tiers` is public and unauthenticated by design — a join
 * page has to render for somebody who is not a member yet — and it used to
 * return the whole row, Stripe object ids included.
 *
 * This is a list rather than a smoke test because the risk is a *future*
 * column: somebody adds a field to `MembershipTier` and it is published to the
 * open internet without anyone deciding that. A select fails closed, and this
 * fails loudly if the shape changes.
 */
describe('the public shape of a membership tier', () => {
  const selected = Object.keys(PUBLIC_TIER_SELECT).sort();

  it('publishes exactly the fields a join page and a tier chooser need', () => {
    expect(selected).toEqual(
      [
        'benefits',
        'description',
        'id',
        'isPayWhatYouCan',
        'maxMembers',
        'minPrice',
        'name',
        'priceMonthly',
        'priceYearly',
        'serviceMinutes',
        'servicePeriod',
      ].sort(),
    );
  });

  it('never publishes the co-op’s Stripe object ids', () => {
    // Not credentials, and a price id does surface at checkout — but a co-op's
    // Stripe object graph is not something to hand to anyone who curls the
    // endpoint.
    for (const field of ['stripePriceIdMonthly', 'stripePriceIdYearly', 'stripeProductId']) {
      expect(selected).not.toContain(field);
    }
  });

  it('never publishes internal bookkeeping', () => {
    // `sortOrder` is the server's business — it does the sorting. `isActive`
    // is always true in this list. The rest is nobody's.
    for (const field of ['orgId', 'sortOrder', 'isActive', 'createdAt', 'updatedAt']) {
      expect(selected).not.toContain(field);
    }
  });

  it('is a select, so a new column is absent rather than published', () => {
    // The load-bearing property: an allowlist fails closed. A redaction list
    // would publish anything somebody forgot to add to it.
    for (const value of Object.values(PUBLIC_TIER_SELECT)) {
      expect(value).toBe(true);
    }
  });
});
