import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AdoptionScanService } from '../adoption-scan.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * Reading a co-op's existing Stripe subscriptions (MIG-01).
 *
 * The scan runs against a live account holding real members' real money, so
 * the property that matters most is the one it is easiest to assert loosely:
 * that it writes nothing. Every write method on both clients is wired to throw
 * here, so "read-only" is proved by the scan completing rather than by anyone
 * having read the code carefully.
 */
describe('scanning a connected account for existing subscriptions', () => {
  const ORG_ID = '11111111-1111-4111-8111-111111111111';
  const ACCOUNT_ID = 'acct_connected';
  const PERIOD_END = 1_791_331_200; // 2026-10-09T00:00:00Z

  let service: AdoptionScanService;
  let prisma: any;
  let list: jest.Mock;
  let refuse: jest.Mock;

  const stripeSubscription = (over: Record<string, unknown> = {}) => ({
    id: 'sub_live',
    status: 'active',
    cancel_at_period_end: false,
    customer: { id: 'cus_1', email: 'Member@Example.com', name: 'A Member' },
    items: {
      data: [
        {
          quantity: 1,
          current_period_end: PERIOD_END,
          price: {
            id: 'price_ten',
            product: 'prod_ten',
            unit_amount: 1000,
            recurring: { interval: 'month', interval_count: 1 },
          },
        },
      ],
    },
    ...over,
  });

  beforeEach(async () => {
    refuse = jest.fn(() => {
      throw new Error('the scan wrote something');
    });

    prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          id: ORG_ID,
          stripeAccountId: ACCOUNT_ID,
          stripeChargesEnabled: true,
        }),
        update: refuse,
        create: refuse,
      },
      userOrg: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'uo_1',
            stripeSubscriptionId: null,
            subscriptionStatus: 'NONE',
            user: { email: 'member@example.com' },
            tier: null,
          },
        ]),
        update: refuse,
        updateMany: refuse,
        create: refuse,
        delete: refuse,
      },
      membershipTier: {
        findMany: jest.fn().mockResolvedValue([
          { id: 't1', name: '$10 Member', priceMonthly: 1000, isPayWhatYouCan: false },
        ]),
        update: refuse,
        create: refuse,
      },
      user: { create: refuse, update: refuse },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdoptionScanService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'sk_test_x' } },
      ],
    }).compile();

    service = moduleRef.get(AdoptionScanService);

    list = jest.fn((params: { status: string }) => ({
      autoPagingToArray: jest
        .fn()
        .mockResolvedValue(params.status === 'active' ? [stripeSubscription()] : []),
    }));

    (service as never as { stripe: unknown }).stripe = {
      subscriptions: { list, create: refuse, update: refuse, cancel: refuse, del: refuse },
      products: {
        retrieve: jest.fn().mockResolvedValue({ id: 'prod_ten', name: 'Membership' }),
        create: refuse,
        update: refuse,
      },
      customers: { create: refuse, update: refuse },
    };
  });

  it('writes nothing, to Stripe or to the database', async () => {
    // Every write method above throws. Reaching the end proves none was called
    // more convincingly than reading the service does.
    const result = await service.scan(ORG_ID);

    expect(result.summary.subscriptions.total).toBe(1);
  });

  it('reads the co-op’s account, not MaybeOS’s own', async () => {
    await service.scan(ORG_ID);

    for (const call of list.mock.calls) {
      expect(call[1]).toEqual({ stripeAccount: ACCOUNT_ID });
    }
  });

  it('asks only for the statuses where money is moving', async () => {
    // `status: 'all'` would drag in years of cancelled subscriptions to be
    // filtered away afterwards, turning a bounded scan into an unbounded one.
    await service.scan(ORG_ID);

    expect(list.mock.calls.map((call) => call[0].status)).toEqual([
      'active',
      'trialing',
      'past_due',
    ]);
  });

  it('matches a Stripe customer to the member with that email', async () => {
    const result = await service.scan(ORG_ID);

    expect(result.rows[0].outcome).toBe('link');
    expect(result.rows[0].userOrgId).toBe('uo_1');
  });

  it('reads the period end off the subscription item', async () => {
    // Stripe moved `current_period_end` onto items; reading the old place
    // returns undefined rather than failing, so a whole roster would adopt
    // with no renewal date and nothing would look wrong.
    const result = await service.scan(ORG_ID);

    expect(result.rows[0].currentPeriodEnd).toEqual(new Date(PERIOD_END * 1000));
  });

  it('suggests the tier whose price matches', async () => {
    const result = await service.scan(ORG_ID);

    expect(result.prices[0].suggestedTierName).toBe('$10 Member');
    expect(result.prices[0].productName).toBe('Membership');
  });

  it('refuses when the co-op has never connected an account', async () => {
    prisma.organization.findUnique.mockResolvedValue({
      id: ORG_ID,
      stripeAccountId: null,
      stripeChargesEnabled: false,
    });

    await expect(service.scan(ORG_ID)).rejects.toThrow(/has not connected a Stripe account/);
  });

  it('scopes every read to the org it was asked about', async () => {
    await service.scan(ORG_ID);

    expect(prisma.userOrg.findMany.mock.calls[0][0].where).toEqual({ orgId: ORG_ID });
    expect(prisma.membershipTier.findMany.mock.calls[0][0].where).toEqual({
      orgId: ORG_ID,
      isActive: true,
    });
  });

  it('does not hand Stripe’s own failure text to the admin', async () => {
    // Stripe writes permission errors for the developer holding the key: they
    // name the restricted key, the account and the missing scope. That key is
    // MaybeOS's, and the viewer here is a co-op admin.
    const leak =
      'This application does not have the required permissions for this endpoint. rk_live_****BuW4ie on acct_connected';
    list.mockImplementation(() => ({
      autoPagingToArray: jest.fn().mockRejectedValue(new Error(leak)),
    }));

    await expect(service.scan(ORG_ID)).rejects.toThrow(/could not read/i);
    await expect(service.scan(ORG_ID)).rejects.not.toThrow(/rk_live/);
  });

  it('says so when it stops early rather than reporting a short roster as complete', async () => {
    const many = Array.from({ length: 2000 }, (_, i) =>
      stripeSubscription({ id: `sub_${i}`, customer: { id: `cus_${i}`, email: `m${i}@example.com` } }),
    );
    list.mockImplementation((params: { status: string }) => ({
      autoPagingToArray: jest.fn().mockResolvedValue(params.status === 'active' ? many : []),
    }));

    const result = await service.scan(ORG_ID);

    expect(result.truncated).toBe(true);
  });
});
