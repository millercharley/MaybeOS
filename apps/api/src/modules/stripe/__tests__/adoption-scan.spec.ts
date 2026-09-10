import {
  itemMonthlyCents,
  subscriptionMonthlyCents,
  normalizeEmail,
  suggestTier,
  groupPrices,
  planRows,
  summarize,
  describeStripeFailure,
  ScanItem,
  ScanSubscription,
  MemberSnapshot,
  TierSnapshot,
} from '../adoption-scan';

/**
 * What a co-op's existing Stripe subscriptions would mean in MaybeOS (MIG-01).
 *
 * All arithmetic and matching, no Stripe. The figure these produce is going to
 * be held up against the co-op's own Stripe dashboard and expected to match,
 * so the interesting cases are the ones that quietly produce a plausible wrong
 * number: annual plans, quantities, and prices with no single amount.
 */

const item = (over: Partial<ScanItem> = {}): ScanItem => ({
  priceId: 'price_1',
  productId: 'prod_1',
  productName: null,
  unitAmountCents: 1000,
  quantity: 1,
  interval: 'month',
  intervalCount: 1,
  ...over,
});

const sub = (over: Partial<ScanSubscription> = {}): ScanSubscription => ({
  id: 'sub_1',
  status: 'active',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: new Date('2026-10-09T00:00:00Z'),
  customerId: 'cus_1',
  email: 'a@example.com',
  name: 'A Member',
  items: [item()],
  ...over,
});

const member = (over: Partial<MemberSnapshot> = {}): MemberSnapshot => ({
  userOrgId: 'uo_1',
  email: 'a@example.com',
  stripeSubscriptionId: null,
  subscriptionStatus: 'NONE',
  tierName: null,
  tierMonthlyCents: null,
  ...over,
});

describe('monthly value', () => {
  it('takes a monthly price at face value', () => {
    expect(itemMonthlyCents(item({ unitAmountCents: 1950 }))).toBe(1950);
  });

  it('spreads an annual price across twelve months', () => {
    // The case that silently inflates MRR twelve-fold if it is not handled:
    // a $120/year member is $10/month, not $120.
    expect(itemMonthlyCents(item({ unitAmountCents: 12000, interval: 'year' }))).toBe(1000);
  });

  it('uses the real number of weeks in a year, not four per month', () => {
    // 52 weekly collections, not 48. Treating a month as four weeks
    // under-reports a weekly co-op's income by about 8%.
    expect(itemMonthlyCents(item({ unitAmountCents: 1000, interval: 'week' }))).toBe(4333);
  });

  it('divides by the interval count', () => {
    // Billed $60 every 3 months is $20/month.
    expect(
      itemMonthlyCents(item({ unitAmountCents: 6000, interval: 'month', intervalCount: 3 })),
    ).toBe(2000);
  });

  it('multiplies by quantity', () => {
    expect(itemMonthlyCents(item({ unitAmountCents: 1000, quantity: 3 }))).toBe(3000);
  });

  it('refuses to price a metered or tiered price rather than guessing', () => {
    expect(itemMonthlyCents(item({ unitAmountCents: null }))).toBeNull();
  });

  it('refuses a one-off price with no recurrence', () => {
    expect(itemMonthlyCents(item({ interval: null }))).toBeNull();
  });

  it('sums the items on a multi-item subscription', () => {
    expect(
      subscriptionMonthlyCents(
        sub({ items: [item({ unitAmountCents: 1000 }), item({ priceId: 'p2', unitAmountCents: 500 })] }),
      ),
    ).toBe(1500);
  });

  it('makes the whole subscription unpriceable when any one item is', () => {
    // Summing the rest would return a number that looks complete and is not.
    expect(
      subscriptionMonthlyCents(
        sub({ items: [item({ unitAmountCents: 1000 }), item({ unitAmountCents: null })] }),
      ),
    ).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Someone@Example.COM ')).toBe('someone@example.com');
  });

  it('leaves plus-aliases and dots alone', () => {
    // Deliberate: collapsing them is a Gmail rule, and applying it elsewhere
    // merges two different people's memberships into one.
    expect(normalizeEmail('a.b+co-op@example.com')).toBe('a.b+co-op@example.com');
  });

  it('treats a missing email as empty rather than throwing', () => {
    expect(normalizeEmail(null)).toBe('');
  });
});

describe('suggestTier', () => {
  const tiers: TierSnapshot[] = [
    { id: 't1', name: 'Sustainer', priceMonthly: 1950, isPayWhatYouCan: false },
    { id: 't2', name: '$10 Member', priceMonthly: 1000, isPayWhatYouCan: false },
    { id: 't3', name: 'Solidarity', priceMonthly: 1000, isPayWhatYouCan: false },
    { id: 't4', name: 'Choose your own', priceMonthly: 0, isPayWhatYouCan: true },
  ];

  it('suggests the tier at exactly that price', () => {
    expect(suggestTier(1950, tiers)?.name).toBe('Sustainer');
  });

  it('suggests nothing when two tiers share the price', () => {
    // An ambiguity the admin resolves. Picking the first would be a coin toss
    // that reads as a decision.
    expect(suggestTier(1000, tiers)).toBeNull();
  });

  it('never suggests a pay-what-you-can tier', () => {
    expect(suggestTier(0, tiers)).toBeNull();
  });

  it('suggests nothing for an unpriceable subscription', () => {
    expect(suggestTier(null, tiers)).toBeNull();
  });
});

describe('groupPrices', () => {
  const tiers: TierSnapshot[] = [
    { id: 't1', name: '$10 Member', priceMonthly: 1000, isPayWhatYouCan: false },
  ];

  it('counts the subscriptions on each price, biggest cohort first', () => {
    const groups = groupPrices(
      [
        sub({ id: 's1', items: [item({ priceId: 'price_small', unitAmountCents: 400 })] }),
        sub({ id: 's2', items: [item({ priceId: 'price_ten' })] }),
        sub({ id: 's3', items: [item({ priceId: 'price_ten' })] }),
      ],
      tiers,
    );

    expect(groups.map((g) => [g.priceId, g.subscriptions])).toEqual([
      ['price_ten', 2],
      ['price_small', 1],
    ]);
  });

  it('prices a group per unit, so a multi-seat member does not match a bigger tier', () => {
    const [group] = groupPrices(
      [sub({ items: [item({ unitAmountCents: 1000, quantity: 2 })] })],
      tiers,
    );

    expect(group.monthlyCents).toBe(1000);
    expect(group.suggestedTierName).toBe('$10 Member');
  });
});

describe('planRows', () => {
  it('links a subscription to the member with that email', () => {
    const [row] = planRows([sub()], [member()]);

    expect(row.outcome).toBe('link');
    expect(row.userOrgId).toBe('uo_1');
  });

  it('matches regardless of case and surrounding space', () => {
    const [row] = planRows([sub({ email: ' A@Example.com ' })], [member()]);
    expect(row.outcome).toBe('link');
  });

  it('would create a member for a subscriber MaybeOS has never seen', () => {
    const [row] = planRows([sub({ email: 'new@example.com' })], [member()]);

    expect(row.outcome).toBe('create');
    expect(row.userOrgId).toBeNull();
  });

  it('leaves an already-linked subscription alone', () => {
    const [row] = planRows([sub()], [member({ stripeSubscriptionId: 'sub_1' })]);
    expect(row.outcome).toBe('already-linked');
  });

  it('flags a member already carrying a different subscription', () => {
    // Adopting over the top would orphan a live subscription: MaybeOS would
    // stop tracking one that Stripe keeps charging.
    const [row] = planRows([sub()], [member({ stripeSubscriptionId: 'sub_other' })]);

    expect(row.outcome).toBe('conflict');
    expect(row.conflict).toBe('member-has-other-subscription');
  });

  it('flags both subscriptions when two share an email', () => {
    const rows = planRows(
      [sub({ id: 'sub_1' }), sub({ id: 'sub_2' })],
      [member()],
    );

    expect(rows.map((r) => r.conflict)).toEqual(['duplicate-email', 'duplicate-email']);
  });

  it('flags a customer with no email at all', () => {
    const [row] = planRows([sub({ email: null })], [member()]);

    expect(row.outcome).toBe('conflict');
    expect(row.conflict).toBe('no-email');
  });

  it('carries the cancellation flag through, so a leaver is not adopted as staying', () => {
    const [row] = planRows([sub({ cancelAtPeriodEnd: true })], [member()]);
    expect(row.cancelAtPeriodEnd).toBe(true);
  });
});

describe('summarize', () => {
  const tiers = { tierName: '$10 Member', tierMonthlyCents: 1000 };

  it('counts only active and trialing money as MRR', () => {
    const subs = [
      sub({ id: 's1', email: 'a@example.com', status: 'active' }),
      sub({ id: 's2', email: 'b@example.com', status: 'trialing' }),
      sub({ id: 's3', email: 'c@example.com', status: 'past_due' }),
    ];

    const summary = summarize(subs, planRows(subs, []), []);

    expect(summary.money.stripeMonthlyCents).toBe(2000);
    // Money at risk, reported apart rather than folded in.
    expect(summary.money.pastDueMonthlyCents).toBe(1000);
  });

  it('reports the gap between what Stripe collects and what MaybeOS believes', () => {
    // The number the whole scan exists to produce: one figure, two systems.
    const subs = [
      sub({ id: 's1', email: 'a@example.com' }),
      sub({ id: 's2', email: 'b@example.com' }),
    ];
    const members = [
      member({ email: 'a@example.com', subscriptionStatus: 'ACTIVE', ...tiers }),
    ];

    const summary = summarize(subs, planRows(subs, members), members);

    expect(summary.money.stripeMonthlyCents).toBe(2000);
    expect(summary.money.maybeosMonthlyCents).toBe(1000);
    expect(summary.money.deltaCents).toBe(1000);
  });

  it('leaves unpriceable subscriptions out of the money and says how many', () => {
    const subs = [sub({ items: [item({ unitAmountCents: null })] })];
    const summary = summarize(subs, planRows(subs, []), subs.length ? [] : []);

    expect(summary.subscriptions.unpriced).toBe(1);
    expect(summary.money.stripeMonthlyCents).toBe(0);
  });

  it('counts members no live subscription matched', () => {
    // Free tier, comped, and lapsed members all land here. They are not
    // errors — they are the half of the roster Stripe cannot see.
    const subs = [sub({ email: 'a@example.com' })];
    const members = [member({ email: 'a@example.com' }), member({ userOrgId: 'uo_2', email: 'free@example.com' })];

    const summary = summarize(subs, planRows(subs, members), members);

    expect(summary.people.membersWithoutSubscription).toBe(1);
  });

  it('counts subscriptions set to end', () => {
    const subs = [sub({ cancelAtPeriodEnd: true }), sub({ id: 's2', email: 'b@example.com' })];
    const summary = summarize(subs, planRows(subs, []), []);

    expect(summary.subscriptions.cancelingAtPeriodEnd).toBe(1);
  });
});

describe('describeStripeFailure', () => {
  const stripeError = (over: Record<string, unknown>) =>
    Object.assign(new Error('unused'), over);

  it('names the fix for the failure this was always most likely to hit', () => {
    const failure = describeStripeFailure(
      stripeError({
        type: 'StripePermissionError',
        statusCode: 403,
        message:
          'This application does not have the required permissions. rk_live_****BuW4ie on acct_1MhgKw',
      }),
    );

    expect(failure.message).toMatch(/restricted key/i);
    expect(failure.message).toMatch(/connected-account access/i);
  });

  it('never repeats a credential fragment, whatever Stripe put in the message', () => {
    // Stripe redacts its own keys to the last four characters, which is not
    // usable — but it is still MaybeOS's key on a co-op admin's screen.
    const failure = describeStripeFailure(
      stripeError({ type: 'rk_live_****BuW4ie', code: 'sk_test_abc', statusCode: 403 }),
    );

    expect(failure.message).not.toMatch(/rk_live|sk_test|pk_live/);
  });

  it('tells a revoked key apart from a forbidden one', () => {
    expect(describeStripeFailure(stripeError({ statusCode: 401 })).message).toMatch(
      /revoked, rolled/i,
    );
  });

  it('says a lost connection can be reconnected', () => {
    expect(describeStripeFailure(stripeError({ code: 'account_invalid' })).message).toMatch(
      /Reconnecting/i,
    );
  });

  it('says an outage is worth retrying rather than fixing', () => {
    expect(describeStripeFailure(stripeError({ type: 'StripeConnectionError' })).message).toMatch(
      /trying again/i,
    );
  });

  it('still says nothing was changed when it cannot explain the failure', () => {
    // The promise the page makes is the one thing that must survive every
    // branch: a failed scan has written nothing either way.
    expect(describeStripeFailure(new Error('something new')).message).toMatch(/Nothing was changed/);
  });

  it('passes Stripe’s own tokens through, so a new failure can still be looked up', () => {
    const failure = describeStripeFailure(
      stripeError({ type: 'StripeInvalidRequestError', code: 'parameter_unknown' }),
    );

    expect(failure.message).toContain('StripeInvalidRequestError · parameter_unknown');
  });
});
