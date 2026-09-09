import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StripeService } from '../stripe.service';
import { PrismaService } from '../../../config/prisma.service';
import { ConnectService } from '../connect.service';

/**
 * Reading a subscription back from Stripe (PLT-07).
 *
 * Everything MaybeOS knows about a subscription arrives by webhook, which
 * holds until one is missed, arrives out of order, or lands before the code
 * knows what to do with it. On 2026-09-09 a member cancelled, the event was
 * handled correctly under the rules that existed, and `cancel_at_period_end`
 * was not stored because the column did not exist yet.
 *
 * **Replaying could not fix it** — `handleWebhook` claims the event id before
 * dispatching, so a resent event is refused by the idempotency guard, which is
 * right. There is no Stripe-side action that repairs a row. Asking Stripe what
 * is true now is the only cure, and this is it.
 */
describe('reconciling a membership against Stripe', () => {
  let service: StripeService;
  let prisma: any;
  let retrieve: jest.Mock;

  const PERIOD_END = 1_791_331_200; // 2026-10-09T00:00:00Z

  const subscription = (over: Record<string, unknown> = {}) => ({
    id: 'sub_test',
    status: 'active',
    cancel_at_period_end: true,
    cancel_at: PERIOD_END,
    items: { data: [{ current_period_end: PERIOD_END }] },
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      userOrg: {
        findUnique: jest.fn().mockResolvedValue({ id: 'uo-1', stripeSubscriptionId: 'sub_test' }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'uo-1', ...data })),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        StripeService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'sk_test_x' } },
        { provide: ConnectService, useValue: { recordTicketFromSession: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(StripeService);
    retrieve = jest.fn().mockResolvedValue(subscription());
    (service as never as { stripe: unknown }).stripe = {
      subscriptions: { retrieve },
    };
  });

  const written = () => prisma.userOrg.update.mock.calls[0][0].data;

  it('stores what Stripe says, including the facts a webhook never delivered', () => {
    return service.reconcileMembership('org-1', 'user-1').then(() => {
      expect(retrieve).toHaveBeenCalledWith('sub_test');
      expect(written().subscriptionStatus).toBe('ACTIVE');
      expect(written().cancelAtPeriodEnd).toBe(true);
      expect(written().currentPeriodEnd).toEqual(new Date(PERIOD_END * 1000));
    });
  });

  it('does nothing for a membership that never subscribed', async () => {
    prisma.userOrg.findUnique.mockResolvedValue({ id: 'uo-1', stripeSubscriptionId: null });

    expect(await service.reconcileMembership('org-1', 'user-1')).toBeNull();
    expect(retrieve).not.toHaveBeenCalled();
    expect(prisma.userOrg.update).not.toHaveBeenCalled();
  });

  it('treats a subscription Stripe no longer has as ended', async () => {
    // The usual way to reach this is a cancellation whose `deleted` event
    // never arrived — precisely what reconciliation exists to repair.
    retrieve.mockRejectedValue(Object.assign(new Error('No such subscription'), {
      code: 'resource_missing',
    }));

    await service.reconcileMembership('org-1', 'user-1');

    expect(written()).toEqual({ subscriptionStatus: 'CANCELED', cancelAtPeriodEnd: false });
  });

  it('does not swallow a Stripe outage', async () => {
    // A network failure must not be read as "the subscription is gone" and
    // cancel somebody's membership.
    retrieve.mockRejectedValue(Object.assign(new Error('connection error'), {
      code: 'api_connection_error',
    }));

    await expect(service.reconcileMembership('org-1', 'user-1')).rejects.toThrow();
    expect(prisma.userOrg.update).not.toHaveBeenCalled();
  });

  it('leaves a status it has no word for alone rather than guessing', async () => {
    // `incomplete_expired` and `unpaid` are real Stripe states this product
    // does not model. Overwriting with a wrong word is worse than keeping a
    // stale right one — but the dates are still worth having.
    retrieve.mockResolvedValue(subscription({ status: 'unpaid' }));

    await service.reconcileMembership('org-1', 'user-1');

    expect(written()).not.toHaveProperty('subscriptionStatus');
    expect(written().currentPeriodEnd).toEqual(new Date(PERIOD_END * 1000));
  });

  it('stops saying "ending" about a subscription that has ended', async () => {
    retrieve.mockResolvedValue(subscription({ status: 'canceled' }));

    await service.reconcileMembership('org-1', 'user-1');

    expect(written().subscriptionStatus).toBe('CANCELED');
    expect(written().cancelAtPeriodEnd).toBe(false);
  });

  it('is safe to run twice', async () => {
    await service.reconcileMembership('org-1', 'user-1');
    const first = written();
    prisma.userOrg.update.mockClear();
    await service.reconcileMembership('org-1', 'user-1');

    expect(prisma.userOrg.update.mock.calls[0][0].data).toEqual(first);
  });
});

describe('the boot sweep', () => {
  let service: StripeService;
  let prisma: any;
  let retrieve: jest.Mock;

  beforeEach(async () => {
    prisma = {
      userOrg: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'uo-1', stripeSubscriptionId: 'sub_a' },
          { id: 'uo-2', stripeSubscriptionId: 'sub_b' },
        ]),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        StripeService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'sk_test_x' } },
        { provide: ConnectService, useValue: { recordTicketFromSession: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(StripeService);
    retrieve = jest.fn().mockResolvedValue({
      id: 'sub_a',
      status: 'active',
      cancel_at_period_end: false,
      cancel_at: null,
      items: { data: [{ current_period_end: 1_791_331_200 }] },
    });
    (service as never as { stripe: unknown }).stripe = { subscriptions: { retrieve } };
  });

  it('looks only at memberships missing the facts', async () => {
    await service.onModuleInit();

    // A subscription id with no period is the signal: every path that writes
    // one now writes the other, so the pair means "never recorded".
    expect(prisma.userOrg.findMany.mock.calls[0][0].where).toEqual({
      stripeSubscriptionId: { not: null },
      currentPeriodEnd: null,
    });
  });

  it('repairs each of them', async () => {
    await service.onModuleInit();
    expect(prisma.userOrg.update).toHaveBeenCalledTimes(2);
  });

  it('keeps going when one fails, and never throws', async () => {
    // A co-op's billing screen must not fail to load over a repair.
    retrieve.mockRejectedValueOnce(new Error('Stripe is having a day'));

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(prisma.userOrg.update).toHaveBeenCalledTimes(1);
  });

  it('does no work, and calls Stripe not at all, when nothing is stale', async () => {
    prisma.userOrg.findMany.mockResolvedValue([]);

    await service.onModuleInit();

    expect(retrieve).not.toHaveBeenCalled();
    expect(prisma.userOrg.update).not.toHaveBeenCalled();
  });
});
