import { readFileSync } from 'fs';
import { join } from 'path';
import { billedElsewhere } from '@/lib/legacy-billing';

/**
 * Imported members, still paying where they always did (MIG-03).
 *
 * MaybeItsFate imported 426 people on 2026-10-02 and MaybeOS holds no
 * subscription for any of them — they are all still charged by the Stripe
 * account they originally signed up through. Their Dues & billing page
 * offered a tier to buy and said nothing whatsoever about the money already
 * leaving their account each month, so the question an imported member
 * actually arrives with — "am I about to pay twice?" — had no answer on it.
 */

const URL = 'https://billing.stripe.com/p/login/abc123';
const TIERS = [
  { id: 'paid', priceMonthly: 1950 },
  { id: 'free', priceMonthly: 0 },
  { id: 'pwyc', priceMonthly: 0, isPayWhatYouCan: true },
];

describe('who is being billed somewhere other than MaybeOS', () => {
  it('is a member on a paid tier that MaybeOS is not charging', () => {
    expect(billedElsewhere({ subscriptionStatus: 'NONE', tierId: 'paid' }, TIERS, URL)).toBe(true);
  });

  it('is not a member MaybeOS already bills', () => {
    // The link would send somebody with a live MaybeOS subscription to a
    // portal that knows nothing about it.
    for (const subscriptionStatus of ['ACTIVE', 'TRIALING', 'PAST_DUE', 'UNPAID', 'INCOMPLETE']) {
      expect(billedElsewhere({ subscriptionStatus, tierId: 'paid' }, TIERS, URL)).toBe(false);
    }
  });

  it('is not a member whose tier costs nothing', () => {
    // 110 of MaybeItsFate's 426 are $0 members. Telling them to go and manage
    // a payment they do not make is worse than telling them nothing.
    expect(billedElsewhere({ subscriptionStatus: 'NONE', tierId: 'free' }, TIERS, URL)).toBe(false);
  });

  it('is a pay-what-you-can member, whose tier has no fixed price', () => {
    expect(billedElsewhere({ subscriptionStatus: 'NONE', tierId: 'pwyc' }, TIERS, URL)).toBe(true);
  });

  it('is nobody when the co-op has no previous billing', () => {
    // A co-op that started on MaybeOS must not show its members a link to an
    // arrangement that never existed.
    expect(billedElsewhere({ subscriptionStatus: 'NONE', tierId: 'paid' }, TIERS, null)).toBe(false);
    expect(billedElsewhere({ subscriptionStatus: 'NONE', tierId: 'paid' }, TIERS, '   ')).toBe(false);
  });

  it('is nobody with no tier at all', () => {
    // Nothing says they pay anything, so nothing should claim they do.
    expect(billedElsewhere({ subscriptionStatus: 'NONE', tierId: null }, TIERS, URL)).toBe(false);
    expect(billedElsewhere({ subscriptionStatus: 'NONE', tierId: 'gone' }, TIERS, URL)).toBe(false);
  });

  it('stops being true once their dues move, with nobody removing it', () => {
    const member = { subscriptionStatus: 'NONE', tierId: 'paid' };

    expect(billedElsewhere(member, TIERS, URL)).toBe(true);
    expect(billedElsewhere({ ...member, subscriptionStatus: 'ACTIVE' }, TIERS, URL)).toBe(false);
  });

  it('treats a cancelled MaybeOS subscription as not billed by MaybeOS', () => {
    expect(billedElsewhere({ subscriptionStatus: 'CANCELED', tierId: 'paid' }, TIERS, URL)).toBe(true);
  });

  it('survives a membership or tier list that is not there yet', () => {
    expect(billedElsewhere(null, TIERS, URL)).toBe(false);
    expect(billedElsewhere({ subscriptionStatus: 'NONE', tierId: 'paid' }, null, URL)).toBe(false);
  });
});

describe('what the member is told', () => {
  const page = readFileSync(
    join(__dirname, '..', 'app', '(app)', '(dashboard)', 'member', '[orgSlug]', 'billing', 'page.tsx'),
    'utf8',
  );

  it('says they have not been charged twice', () => {
    // The actual worry. Saying everything except this would be a page that
    // answers a question nobody asked.
    expect(page).toMatch(/not been charged twice/);
  });

  it('warns that picking a tier here does not stop the old payment', () => {
    // The one thing on this page that can cost somebody real money: a second
    // subscription runs alongside the first until a human cancels it.
    expect(page).toMatch(/cancel your existing payment first/);
  });

  it('opens the old portal in a new tab, safely', () => {
    expect(page).toMatch(/rel="noopener noreferrer"/);
  });

  it('does not tell a paying member their membership is "Not set up"', () => {
    expect(page).toMatch(/payingElsewhere \? 'Active'/);
  });
});

describe('the admin is asked for it where it matters', () => {
  const importPage = readFileSync(
    join(__dirname, '..', 'app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'members', 'import', 'page.tsx'),
    'utf8',
  );
  const settings = readFileSync(
    join(__dirname, '..', 'app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'settings', 'page.tsx'),
    'utf8',
  );

  it('asks right after an import, while they are thinking about it', () => {
    expect(importPage).toMatch(/Where do these members pay at the moment/);
  });

  it('does not ask a co-op that has already answered', () => {
    expect(importPage).toMatch(/!org\?\.legacyBillingUrl/);
  });

  it('does not ask when the import created nobody', () => {
    expect(importPage).toMatch(/result\.created > 0/);
  });

  it('can still be set and cleared in Settings', () => {
    expect(settings).toMatch(/<LegacyBilling\b/);
  });
});
