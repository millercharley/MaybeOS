import { readFileSync } from 'fs';
import { join } from 'path';
import { MANUAL_STATUSES, STATUS_LABEL, canSetStatus } from '@/lib/member-status';

/**
 * A status an organiser sets by hand (MEM-23).
 *
 * MaybeItsFate has 110 members on a $0 tier. They will never have a Stripe
 * subscription, so the roster showed all of them as NONE and their own
 * billing page read "Not set up" — Stripe being asked to answer a question
 * about whether somebody is a member of a co-op.
 */

describe('who an organiser may set a status for', () => {
  it('may set one for a member nothing is billing', () => {
    expect(canSetStatus({ stripeSubscriptionId: null })).toBe(true);
    expect(canSetStatus({})).toBe(true);
  });

  it('may not set one Stripe is deciding', () => {
    // The next webhook overwrites it, so it would be right until it silently
    // was not — and in between it is the screen an organiser trusts.
    expect(canSetStatus({ stripeSubscriptionId: 'sub_123' })).toBe(false);
  });
});

describe('what the statuses are called', () => {
  it('offers only the four that describe a membership', () => {
    expect(MANUAL_STATUSES).toEqual(['ACTIVE', 'PAST_DUE', 'CANCELED', 'NONE']);
  });

  it('writes them the way a person reads them', () => {
    // The roster used to print the database's own word, in capitals.
    expect(STATUS_LABEL.CANCELED).toBe('Cancelled');
    expect(STATUS_LABEL.NONE).toBe('Not set up');
    expect(STATUS_LABEL.PAST_DUE).toBe('Past due');
  });

  it('has a word for the states only Stripe produces', () => {
    // They are not settable, but they are displayable.
    expect(STATUS_LABEL.TRIALING).toBeTruthy();
    expect(STATUS_LABEL.UNPAID).toBeTruthy();
    expect(STATUS_LABEL.INCOMPLETE).toBeTruthy();
  });
});

describe('the roster offers it where it works', () => {
  const page = readFileSync(
    join(__dirname, '..', 'app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'members', 'page.tsx'),
    'utf8',
  );

  it('shows a control only where the status is settable', () => {
    expect(page).toMatch(/canSetStatus\(member\) \?/);
  });

  it('says who is deciding, for the ones it cannot change', () => {
    expect(page).toMatch(/title=\{STRIPE_OWNS_IT\}/);
  });

  it('shows the refusal rather than swallowing it', () => {
    expect(page).toMatch(/Could not change that status/);
  });
});

describe('a member set Active by hand is not sent to a portal', () => {
  const billing = readFileSync(
    join(__dirname, '..', 'app', '(app)', '(dashboard)', 'member', '[orgSlug]', 'billing', 'page.tsx'),
    'utf8',
  );

  it('decides on Stripe, not on the status', () => {
    // A $0 member set Active has no Stripe customer, so a portal session
    // cannot be created for them — the button would simply fail.
    expect(billing).toMatch(/hasBillingAccount = membership\.stripeBilled === true/);
    expect(billing).not.toMatch(/hasBillingAccount = membership\.subscriptionStatus !== 'NONE'/);
  });

  it('does not route their tier change through the portal either', () => {
    expect(billing).toMatch(/mustUsePortal =\s*\n?\s*membership\.stripeBilled === true/);
  });
});
