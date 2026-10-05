import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StripeService } from '../stripe.service';

/**
 * Member dues on the co-op's own connected Stripe account, and the Free plan's
 * dues fee (PAY-09, Charley 2026-09-15).
 *
 * Until this, a dues checkout ran on MaybeOS's own account, so a member's dues
 * were paid to MaybeOS. What must hold now:
 * - dues are charged on the co-op's account, or not at all;
 * - a tier or customer still on MaybeOS's account is recreated on the co-op's;
 * - on Free, $2.00 is added on top as its own line, and taken as the
 *   application fee;
 * - leaving Free takes the fee off.
 */
describe('dues on the co-op’s connected account', () => {
  const ACCT = 'acct_coop';
  let service: StripeService;
  let stripe: Record<string, any>;
  let prisma: Record<string, any>;
  let org: Record<string, unknown>;

  const tier = (over: Record<string, unknown> = {}) => ({
    id: 'tier-1',
    orgId: 'org-1',
    name: 'Supporter',
    description: null,
    priceMonthly: 1000,
    isPayWhatYouCan: false,
    minPrice: null,
    stripeProductId: 'prod_coop',
    stripePriceIdMonthly: 'price_coop',
    stripeDuesAccountId: ACCT,
    ...over,
  });

  beforeEach(() => {
    org = { stripeAccountId: ACCT, stripeChargesEnabled: true, plan: 'FREE', stripeConnectObjects: null };
    stripe = {
      customers: { create: jest.fn().mockResolvedValue({ id: 'cus_coop' }) },
      products: { create: jest.fn().mockResolvedValue({ id: 'prod_new' }) },
      prices: { create: jest.fn().mockResolvedValue({ id: 'price_new' }) },
      checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://checkout' }) } },
      subscriptions: { retrieve: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      membershipTier: {
        findFirst: jest.fn().mockResolvedValue(tier()),
        update: jest.fn(({ data }) => Promise.resolve({ ...tier(), ...data })),
      },
      organization: {
        findUnique: jest.fn(() => Promise.resolve(org)),
        update: jest.fn(({ data }) => {
          Object.assign(org, data);
          return Promise.resolve(org);
        }),
      },
      userOrg: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'uo-1',
          stripeCustomerId: null,
          stripeDuesAccountId: null,
          stripeSubscriptionId: null,
          subscriptionStatus: 'NONE',
          user: { email: 'priya@example.com', name: 'Priya' },
        }),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new StripeService(
      { get: (k: string) => (k === 'STRIPE_SECRET_KEY' ? 'sk_test_x' : '') } as unknown as ConfigService,
      prisma as never,
      {} as never,
    );
    (service as unknown as { stripe: unknown }).stripe = stripe;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const checkout = (amount?: number) =>
    service.createCheckoutSession('org-1', 'user-1', 'tier-1', 'https://ok', 'https://cancel', amount);

  it('refuses dues until the co-op has connected Stripe', async () => {
    org.stripeAccountId = null;
    await expect(checkout()).rejects.toThrow(BadRequestException);
    org.stripeAccountId = ACCT;
    org.stripeChargesEnabled = false;
    await expect(checkout()).rejects.toThrow(/connect Stripe/);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('runs the checkout, and creates the customer, on the co-op’s account', async () => {
    org.plan = 'PLUS';
    await checkout();

    expect(stripe.customers.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'priya@example.com' }), {
      stripeAccount: ACCT,
    });
    expect(prisma.userOrg.update).toHaveBeenCalledWith({
      where: { id: 'uo-1' },
      data: { stripeCustomerId: 'cus_coop', stripeDuesAccountId: ACCT },
    });
    const [params, options] = stripe.checkout.sessions.create.mock.calls[0];
    expect(options).toEqual({ stripeAccount: ACCT });
    expect(params.line_items).toEqual([{ price: 'price_coop', quantity: 1 }]);
    expect(params.subscription_data).not.toHaveProperty('application_fee_percent');
  });

  it('recreates a tier still on MaybeOS’s account on the co-op’s account first', async () => {
    org.plan = 'PLUS';
    prisma.membershipTier.findFirst.mockResolvedValue(
      tier({ stripeDuesAccountId: null, stripeProductId: 'prod_platform', stripePriceIdMonthly: 'price_platform' }),
    );

    await checkout();

    expect(stripe.products.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Supporter' }), { stripeAccount: ACCT });
    expect(stripe.prices.create).toHaveBeenCalledWith(expect.objectContaining({ unit_amount: 1000 }), { stripeAccount: ACCT });
    expect(prisma.membershipTier.update).toHaveBeenCalledWith({
      where: { id: 'tier-1' },
      data: { stripeProductId: 'prod_new', stripePriceIdMonthly: 'price_new', stripeDuesAccountId: ACCT },
    });
    expect(stripe.checkout.sessions.create.mock.calls[0][0].line_items[0]).toEqual({ price: 'price_new', quantity: 1 });
  });

  it('does not reuse a customer from MaybeOS’s account, which cannot pay on the co-op’s', async () => {
    org.plan = 'PLUS';
    prisma.userOrg.findUnique.mockResolvedValue({
      id: 'uo-1',
      stripeCustomerId: 'cus_platform',
      stripeDuesAccountId: null,
      subscriptionStatus: 'CANCELED',
      user: { email: 'priya@example.com', name: 'Priya' },
    });
    await checkout();
    expect(stripe.checkout.sessions.create.mock.calls[0][0].customer).toBe('cus_coop');
  });

  describe('on the Free plan', () => {
    it('adds $2.00 on top as its own line, and takes it as the application fee', async () => {
      await checkout();

      const [params] = stripe.checkout.sessions.create.mock.calls[0];
      expect(params.line_items).toEqual([
        { price: 'price_coop', quantity: 1 },
        {
          price_data: { currency: 'usd', product: 'prod_new', unit_amount: 200, recurring: { interval: 'month' } },
          quantity: 1,
        },
      ]);
      // 200 of 1,200 cents.
      expect(params.subscription_data.application_fee_percent).toBe(16.67);
      expect(params.subscription_data.metadata.duesFeeCents).toBe('200');
      // The fee product is made once and remembered with its account.
      expect(stripe.products.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'MaybeOS fee' }), {
        stripeAccount: ACCT,
      });
      expect(org.stripeConnectObjects).toMatchObject({ accountId: ACCT, feeProductId: 'prod_new' });
    });

    it('works out the fee from what a pay-what-you-can member chose', async () => {
      prisma.membershipTier.findFirst.mockResolvedValue(tier({ isPayWhatYouCan: true, minPrice: 500, stripePriceIdMonthly: null }));
      await checkout(2500);
      const [params] = stripe.checkout.sessions.create.mock.calls[0];
      expect(params.subscription_data.application_fee_percent).toBe(7.41); // 200 of 2,700
    });

    it('charges no fee on a $0 tier', async () => {
      prisma.membershipTier.findFirst.mockResolvedValue(tier({ priceMonthly: 0 }));
      await checkout();
      const [params] = stripe.checkout.sessions.create.mock.calls[0];
      expect(params.line_items).toHaveLength(1);
      expect(params.subscription_data.metadata.duesFeeCents).toBe('0');
    });
  });

  describe('after leaving Free', () => {
    it('takes the fee line and the application fee off, and records it', async () => {
      org.stripeConnectObjects = { accountId: ACCT, feeProductId: 'prod_fee' };
      prisma.userOrg.findMany.mockResolvedValue([
        { id: 'uo-1', orgId: 'org-1', stripeSubscriptionId: 'sub_1', stripeDuesAccountId: ACCT },
      ]);
      stripe.subscriptions.retrieve.mockResolvedValue({
        id: 'sub_1',
        status: 'active',
        items: { data: [{ id: 'si_dues', price: { product: 'prod_coop' } }, { id: 'si_fee', price: { product: 'prod_fee' } }] },
      });

      expect(await service.removeDuesFeesAfterUpgrade()).toEqual({ removed: 1, failed: 0 });
      expect(prisma.userOrg.findMany.mock.calls[0][0].where).toMatchObject({
        duesFeeCents: { gt: 0 },
        org: { plan: { not: 'FREE' } },
      });
      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        'sub_1',
        { items: [{ id: 'si_fee', deleted: true }], application_fee_percent: '', proration_behavior: 'none' },
        { stripeAccount: ACCT },
      );
      expect(prisma.userOrg.update).toHaveBeenCalledWith({ where: { id: 'uo-1' }, data: { duesFeeCents: 0 } });
    });

    it('leaves a membership for the next pass when Stripe fails', async () => {
      prisma.userOrg.findMany.mockResolvedValue([
        { id: 'uo-1', orgId: 'org-1', stripeSubscriptionId: 'sub_1', stripeDuesAccountId: ACCT },
      ]);
      stripe.subscriptions.retrieve.mockRejectedValue(new Error('rate limited'));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      expect(await service.removeDuesFeesAfterUpgrade()).toEqual({ removed: 0, failed: 1 });
      expect(prisma.userOrg.update).not.toHaveBeenCalled();
    });
  });
});

/**
 * The co-op's one-time joining fee, on the way in (PAY-10).
 *
 * Charley: "Some organizations will need to charge a one-time initiation fee
 * for their memberships... including setting the amount."
 *
 * It rides on the same checkout as the first month — one card entry, one
 * receipt — as a line item with no `recurring`, which Stripe bills on the
 * first invoice and never again. The tests below are the ways that goes
 * wrong with somebody's money.
 */
describe('StripeService — the joining fee', () => {
  const ACCT = 'acct_coop';
  let service: StripeService;
  let stripe: any;
  let prisma: any;
  let org: any;
  let membership: any;

  const tierWith = (initiationFeeCents: number) => ({
    id: 'tier-1',
    orgId: 'org-1',
    name: 'Full member',
    priceMonthly: 1500,
    isPayWhatYouCan: false,
    minPrice: null,
    initiationFeeCents,
    stripeProductId: 'prod_coop',
    stripePriceIdMonthly: 'price_coop',
    stripeDuesAccountId: ACCT,
  });

  const build = (initiationFeeCents: number, paidAt: Date | null = null, plan = 'PLUS') => {
    org = { stripeAccountId: ACCT, stripeChargesEnabled: true, plan, stripeConnectObjects: null };
    membership = {
      id: 'uo-1',
      stripeCustomerId: 'cus_coop',
      stripeDuesAccountId: ACCT,
      stripeSubscriptionId: null,
      subscriptionStatus: 'NONE',
      initiationFeePaidAt: paidAt,
      user: { email: 'priya@example.com', name: 'Priya' },
    };
    stripe = {
      customers: { create: jest.fn().mockResolvedValue({ id: 'cus_coop' }) },
      products: { create: jest.fn().mockResolvedValue({ id: 'prod_join' }) },
      prices: { create: jest.fn().mockResolvedValue({ id: 'price_new' }) },
      checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://checkout' }) } },
      subscriptions: { retrieve: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      membershipTier: {
        findFirst: jest.fn().mockResolvedValue(tierWith(initiationFeeCents)),
        update: jest.fn(({ data }: any) => Promise.resolve({ ...tierWith(initiationFeeCents), ...data })),
      },
      organization: {
        findUnique: jest.fn(() => Promise.resolve(org)),
        update: jest.fn(({ data }: any) => {
          Object.assign(org, data);
          return Promise.resolve(org);
        }),
      },
      userOrg: {
        findUnique: jest.fn().mockResolvedValue(membership),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new StripeService(
      { get: (k: string) => (k === 'STRIPE_SECRET_KEY' ? 'sk_test_x' : '') } as unknown as ConfigService,
      prisma as never,
      {} as never,
    );
    (service as unknown as { stripe: unknown }).stripe = stripe;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  };

  afterEach(() => jest.restoreAllMocks());

  const checkout = () =>
    service.createCheckoutSession('org-1', 'user-1', 'tier-1', 'https://ok', 'https://cancel');

  const itemsOf = () => stripe.checkout.sessions.create.mock.calls[0][0].line_items;

  it('adds the fee to the same checkout as the first month', async () => {
    build(5000);
    await checkout();

    const joining = itemsOf().find((i: any) => i.price_data?.unit_amount === 5000);
    expect(joining).toBeDefined();
    // One card entry and one receipt, showing both what they paid to join
    // and what they will pay each month.
    expect(itemsOf()).toHaveLength(2);
  });

  it('charges it once, not every month', async () => {
    build(5000);
    await checkout();

    const joining = itemsOf().find((i: any) => i.price_data?.unit_amount === 5000);
    // No `recurring`, which is the whole of what makes Stripe bill it on the
    // first invoice and never again.
    expect(joining.price_data.recurring).toBeUndefined();
  });

  it('does not charge a member who has already paid it', async () => {
    // Moving between tiers is not joining again.
    build(5000, new Date('2026-01-01'));
    await checkout();

    expect(itemsOf()).toHaveLength(1);
    expect(itemsOf()[0].price).toBe('price_coop');
  });

  it('adds nothing on a tier that does not charge one', async () => {
    build(0);
    await checkout();

    expect(itemsOf()).toHaveLength(1);
  });

  it('tells the subscription what was charged, so it can be recorded', async () => {
    build(5000);
    await checkout();

    const params = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(params.metadata.initiationCents).toBe('5000');
    expect(params.subscription_data.metadata.initiationCents).toBe('5000');
  });

  it('runs on the co-op’s own Stripe account, not MaybeOS’s', async () => {
    // The joining fee is the co-op's money.
    build(5000);
    await checkout();

    expect(stripe.checkout.sessions.create.mock.calls[0][1]).toEqual({ stripeAccount: ACCT });
    expect(stripe.products.create.mock.calls[0][1]).toEqual({ stripeAccount: ACCT });
  });
});
