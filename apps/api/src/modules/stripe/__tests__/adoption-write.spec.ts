import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AdoptionScanService } from '../adoption-scan.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * Writing the adoption (MIG-02).
 *
 * The one path in this module that changes anything — and even here, nothing
 * changes *in Stripe*. It links subscriptions that already exist and already
 * bill; no charge is made, none is cancelled, no card is touched.
 *
 * What these hold down is the shape of a migration that runs against a real
 * co-op's money: that a preview is the default, that a second run repairs
 * rather than duplicates, and that a batch which stops half way says so.
 */
describe('adopting existing subscriptions', () => {
  const ORG_ID = '11111111-1111-4111-8111-111111111111';
  const TIER = '22222222-2222-4222-8222-222222222222';
  const PERIOD_END = 1_791_331_200;
  const STARTED = 1_695_000_000;

  let service: AdoptionScanService;
  let prisma: any;

  const stripeSub = (over: Record<string, unknown> = {}) => ({
    id: 'sub_a',
    status: 'active',
    cancel_at_period_end: false,
    start_date: STARTED,
    customer: { id: 'cus_a', email: 'a@example.com', name: 'A Member' },
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

  const mapping = [{ priceId: 'price_ten', tierId: TIER }];
  const asMap = { price_ten: TIER };

  function build(subs: unknown[], memberships: unknown[] = []) {
    prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          id: ORG_ID,
          stripeAccountId: 'acct_x',
          stripeChargesEnabled: true,
        }),
      },
      userOrg: {
        findMany: jest.fn().mockResolvedValue(memberships),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
      membershipTier: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: TIER, name: '$10 Member', priceMonthly: 1000, isPayWhatYouCan: false },
          ]),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'user-new' }),
      },
    };

    return Test.createTestingModule({
      providers: [
        AdoptionScanService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'sk_test_x' } },
      ],
    })
      .compile()
      .then((moduleRef) => {
        service = moduleRef.get(AdoptionScanService);
        (service as never as { stripe: unknown }).stripe = {
          subscriptions: {
            list: jest.fn((params: { status: string }) => ({
              autoPagingToArray: jest
                .fn()
                .mockResolvedValue(params.status === 'active' ? subs : []),
            })),
          },
          products: { retrieve: jest.fn().mockResolvedValue({ id: 'prod_ten', name: 'Dues' }) },
        };
      });
  }

  it('writes nothing on a dry run, and still reports what would happen', async () => {
    await build([stripeSub()]);

    const result = await service.adopt(ORG_ID, { mapping: asMap, dryRun: true });

    expect(result.counts.created).toBe(1);
    expect(prisma.userOrg.create).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('creates a membership carrying the money, the dates and the tier', async () => {
    await build([stripeSub()]);

    await service.adopt(ORG_ID, { mapping: asMap, dryRun: false });

    const { data } = prisma.userOrg.create.mock.calls[0][0];
    expect(data).toMatchObject({
      orgId: ORG_ID,
      role: 'MEMBER',
      tierId: TIER,
      stripeCustomerId: 'cus_a',
      stripeSubscriptionId: 'sub_a',
      subscriptionStatus: 'ACTIVE',
      cancelAtPeriodEnd: false,
    });
    expect(data.currentPeriodEnd).toEqual(new Date(PERIOD_END * 1000));
    // Stripe's own start date, not the date of the import: a co-op of three
    // years should not import as though everyone arrived this morning.
    expect(data.memberSince).toEqual(new Date(STARTED * 1000));
  });

  it('carries a cancellation across, so somebody leaving is not adopted as staying', async () => {
    await build([stripeSub({ cancel_at_period_end: true })]);

    await service.adopt(ORG_ID, { mapping: asMap, dryRun: false });

    expect(prisma.userOrg.create.mock.calls[0][0].data.cancelAtPeriodEnd).toBe(true);
  });

  it('updates the membership when the person is already a member', async () => {
    await build(
      [stripeSub()],
      [
        {
          id: 'uo_1',
          stripeSubscriptionId: null,
          subscriptionStatus: 'NONE',
          user: { email: 'a@example.com' },
          tier: null,
        },
      ],
    );

    const result = await service.adopt(ORG_ID, { mapping: asMap, dryRun: false });

    expect(result.counts.linked).toBe(1);
    expect(prisma.userOrg.create).not.toHaveBeenCalled();
    expect(prisma.userOrg.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'uo_1' } }),
    );
  });

  it('refreshes rather than duplicates when run a second time', async () => {
    // Matching is on the subscription id, so a run that died half way can be
    // run again — the property that makes a 371-member import safe to retry.
    await build(
      [stripeSub()],
      [
        {
          id: 'uo_1',
          stripeSubscriptionId: 'sub_a',
          subscriptionStatus: 'ACTIVE',
          user: { email: 'a@example.com' },
          tier: { name: '$10 Member', priceMonthly: 1000 },
        },
      ],
    );

    const result = await service.adopt(ORG_ID, { mapping: asMap, dryRun: false });

    expect(result.counts.refreshed).toBe(1);
    expect(result.counts.created).toBe(0);
    expect(prisma.userOrg.create).not.toHaveBeenCalled();
  });

  it('reuses an account that exists without being a member here', async () => {
    await build([stripeSub()]);
    prisma.user.findUnique.mockResolvedValue({ id: 'user-existing' });

    await service.adopt(ORG_ID, { mapping: asMap, dryRun: false });

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.userOrg.create.mock.calls[0][0].data.userId).toBe('user-existing');
  });

  it('skips a subscription whose price nobody mapped', async () => {
    await build([stripeSub()]);

    const result = await service.adopt(ORG_ID, { mapping: {}, dryRun: false });

    expect(result.counts.skipped).toBe(1);
    expect(result.byConflict['no-tier-for-price']).toBe(1);
    expect(prisma.userOrg.create).not.toHaveBeenCalled();
  });

  it('refuses a tier belonging to another co-op', async () => {
    // Otherwise a mapping posted by hand grants this org's members someone
    // else's price (SEC-04).
    await build([stripeSub()]);

    await expect(
      service.adopt(ORG_ID, {
        mapping: { price_ten: '33333333-3333-4333-8333-333333333333' },
        dryRun: false,
      }),
    ).rejects.toThrow(/does not belong to this co-op/);
  });

  it('stops at the batch size and hands back where to carry on', async () => {
    const many = [1, 2, 3].map((n) =>
      stripeSub({ id: `sub_${n}`, customer: { id: `cus_${n}`, email: `m${n}@example.com` } }),
    );
    await build(many);

    const first = await service.adopt(ORG_ID, { mapping: asMap, dryRun: false, limit: 2 });

    expect(first.processed).toBe(2);
    expect(first.done).toBe(false);
    expect(first.nextAfter).toBe('sub_2');

    const second = await service.adopt(ORG_ID, {
      mapping: asMap,
      dryRun: false,
      limit: 2,
      after: first.nextAfter as string,
    });

    expect(second.processed).toBe(1);
    expect(second.done).toBe(true);
    expect(second.nextAfter).toBeNull();
  });

  it('records a row that fails without abandoning the batch', async () => {
    await build([
      stripeSub({ id: 'sub_a', customer: { id: 'c1', email: 'a@example.com' } }),
      stripeSub({ id: 'sub_b', customer: { id: 'c2', email: 'b@example.com' } }),
    ]);
    prisma.userOrg.create.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({});

    const result = await service.adopt(ORG_ID, { mapping: asMap, dryRun: false });

    expect(result.counts.created).toBe(1);
    expect(result.counts.errors).toEqual([{ email: 'a@example.com', reason: 'boom' }]);
  });
});
