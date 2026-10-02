import { tierIdFor, UnknownTierError } from '../import-tier';
import { enrichment } from '../member.service';

/**
 * A roster says what each member pays (MEM-21).
 *
 * MaybeItsFate imported 426 members on 2026-10-02 and the Members page showed
 * a dash in the Tier column for all of them: the only thing that had ever set
 * a tier was Stripe, and these memberships have no Stripe subscription yet.
 * The co-op knew the answer — it is the column its cap table is built around
 * — and the importer had nowhere to put it.
 *
 * What this deliberately does not do is set a status. A spreadsheet saying
 * "Sustainer" records what somebody signed up for; it is not evidence that a
 * card charged this month, and writing ACTIVE from a file would make the
 * admin page confidently wrong about 400 people's money.
 */

const TIERS = [
  { id: 'tier-sustainer', name: 'Sustainer' },
  { id: 'tier-10', name: '$10 Member' },
  { id: 'tier-0', name: '$0 Member' },
];

describe('matching a roster’s tier to the co-op’s own', () => {
  it('finds the tier by the name a person would type', () => {
    expect(tierIdFor('Sustainer', TIERS)).toBe('tier-sustainer');
    expect(tierIdFor('$10 Member', TIERS)).toBe('tier-10');
  });

  it('forgives case and stray spacing from a spreadsheet', () => {
    expect(tierIdFor('  sustainer ', TIERS)).toBe('tier-sustainer');
    expect(tierIdFor('$10   Member', TIERS)).toBe('tier-10');
  });

  it('says nothing when the row says nothing', () => {
    // Most rosters have no tier column at all, and that is not an error.
    expect(tierIdFor(undefined, TIERS)).toBeUndefined();
    expect(tierIdFor('   ', TIERS)).toBeUndefined();
  });

  it('refuses a tier this co-op does not have', () => {
    // Importing them with no tier instead is how a roster ends up half
    // priced with nobody noticing.
    expect(() => tierIdFor('Gold', TIERS)).toThrow(UnknownTierError);
  });

  it('names the tiers it does have, since the organiser cannot see them', () => {
    expect(() => tierIdFor('Gold', TIERS)).toThrow(/"Sustainer", "\$10 Member", "\$0 Member"/);
  });

  it('does not fuzzy-match a tier that merely looks similar', () => {
    // "$10 Member" and "$100 Member" are one character apart and twelve
    // hundred dollars a year apart.
    expect(() => tierIdFor('$100 Member', TIERS)).toThrow(UnknownTierError);
  });

  it('says plainly when a co-op has no tiers at all', () => {
    expect(() => tierIdFor('Sustainer', [])).toThrow(/none set up yet/);
  });
});

describe('what an import may change about a tier already set', () => {
  const existing = {
    altEmail: null,
    tierId: null,
    bio: null,
    headline: null,
    location: null,
    tags: [],
    links: [],
    emailOptIn: null,
  };

  it('fills a membership that has no tier', () => {
    expect(enrichment(existing, { tierId: 'tier-10' }).tierId).toBe('tier-10');
  });

  it('never moves a tier that is already there', () => {
    // It came from Stripe, or from an organiser who meant it. Both know
    // better than the export of the system the co-op is leaving — and a
    // re-import is the thing an organiser does when something went wrong,
    // not a mandate to reprice the roster.
    const filled = enrichment({ ...existing, tierId: 'tier-sustainer' }, { tierId: 'tier-0' });

    expect(filled.tierId).toBeUndefined();
  });

  it('leaves the tier alone when the row has none', () => {
    expect(enrichment(existing, {}).tierId).toBeUndefined();
  });

  it('never writes a subscription status', () => {
    // The one thing a .csv must not be allowed to claim.
    const filled = enrichment(existing, { tierId: 'tier-10' });

    expect(Object.keys(filled)).not.toContain('subscriptionStatus');
    expect(Object.keys(filled)).not.toContain('stripeSubscriptionId');
  });
});
