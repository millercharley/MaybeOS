import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { StripeService } from '../stripe.service';
import { ConnectService } from '../connect.service';
import { PrismaService } from '../../../config/prisma.service';

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: jest.fn(),
    },
    customers: { create: jest.fn() },
    checkout: { sessions: { create: jest.fn() } },
    billingPortal: { sessions: { create: jest.fn() } },
    subscriptions: { retrieve: jest.fn() },
    products: { create: jest.fn() },
    prices: { create: jest.fn() },
  }));
});

describe('StripeService', () => {
  let service: StripeService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeService,
        // Ticket sales are recorded by ConnectService (D-013); these tests
        // cover membership dues and never reach that branch.
        { provide: ConnectService, useValue: { recordTicketFromSession: jest.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string> = {
                STRIPE_SECRET_KEY: 'sk_test_fake',
                STRIPE_WEBHOOK_SECRET: 'whsec_test',
              };
              return config[key] || '';
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            // handleWebhook now claims and dispatches inside one interactive
            // transaction, so the mock runs the callback against itself. That
            // keeps the per-model jest.fn()s below observable while exercising
            // the real control flow. Rollback isn't simulated — the tests that
            // care about it assert on the thrown error instead.
            $transaction: jest.fn(function (this: any, cb: any) {
              return cb(this);
            }),
            webhookEvent: {
              findUnique: jest.fn(),
              create: jest.fn(),
            },
            userOrg: {
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
            },
            membershipTier: {
              // findFirst, not findUnique: the tier is resolved through the
              // org being joined so a checkout cannot target another co-op's
              // tier (SEC-04).
              findFirst: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<StripeService>(StripeService);
    prisma = module.get(PrismaService);
  });

  describe('createCheckoutSession (pay-what-you-can)', () => {
    const pwycTier = {
      id: 'tier-pwyc',
      orgId: 'org-1',
      name: 'Solidarity',
      isPayWhatYouCan: true,
      minPrice: 1000,
      stripeProductId: 'prod_abc',
      stripePriceIdMonthly: 'price_fixed',
    };

    beforeEach(() => {
      prisma.userOrg.findUnique.mockResolvedValue({
        id: 'uo-1',
        stripeCustomerId: 'cus_1',
        user: { email: 'a@b.co', name: 'A' },
      });
    });

    it('charges the amount the member chose', async () => {
      prisma.membershipTier.findFirst.mockResolvedValue(pwycTier);
      const stripe = (service as any).stripe;
      stripe.checkout.sessions.create.mockResolvedValue({ url: 'https://pay' });

      await service.createCheckoutSession('org-1', 'u1', 'tier-pwyc', 'https://s', 'https://c', 2500);

      const args = stripe.checkout.sessions.create.mock.calls[0][0];
      expect(args.line_items[0].price_data).toEqual({
        currency: 'usd',
        product: 'prod_abc',
        unit_amount: 2500,
        recurring: { interval: 'month' },
      });
    });

    it('rejects an amount below the tier minimum', async () => {
      prisma.membershipTier.findFirst.mockResolvedValue(pwycTier);
      await expect(
        service.createCheckoutSession('org-1', 'u1', 'tier-pwyc', 'https://s', 'https://c', 100),
      ).rejects.toThrow(BadRequestException);
    });

    it('enforces the 50c Stripe floor when the tier minimum is lower', async () => {
      prisma.membershipTier.findFirst.mockResolvedValue({ ...pwycTier, minPrice: 1 });
      await expect(
        service.createCheckoutSession('org-1', 'u1', 'tier-pwyc', 'https://s', 'https://c', 10),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires an amount for a pay-what-you-can tier', async () => {
      prisma.membershipTier.findFirst.mockResolvedValue(pwycTier);
      await expect(
        service.createCheckoutSession('org-1', 'u1', 'tier-pwyc', 'https://s', 'https://c'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an amount on a fixed-price tier rather than ignoring it', async () => {
      prisma.membershipTier.findFirst.mockResolvedValue({
        ...pwycTier,
        isPayWhatYouCan: false,
      });
      await expect(
        service.createCheckoutSession('org-1', 'u1', 'tier-x', 'https://s', 'https://c', 9999),
      ).rejects.toThrow(BadRequestException);
    });

    it('still uses the fixed price when no amount is given', async () => {
      prisma.membershipTier.findFirst.mockResolvedValue({
        ...pwycTier,
        isPayWhatYouCan: false,
      });
      const stripe = (service as any).stripe;
      stripe.checkout.sessions.create.mockResolvedValue({ url: 'https://pay' });

      await service.createCheckoutSession('org-1', 'u1', 'tier-x', 'https://s', 'https://c');

      const args = stripe.checkout.sessions.create.mock.calls[0][0];
      expect(args.line_items[0]).toEqual({ price: 'price_fixed', quantity: 1 });
    });
  });

  describe('repriceTier', () => {
    const tier = {
      id: 'tier-1',
      name: 'Community',
      stripeProductId: 'prod_1',
      stripePriceIdMonthly: 'price_old',
    };

    it('creates a new Price and archives the old one (Stripe Prices are immutable)', async () => {
      const stripe = (service as any).stripe;
      stripe.prices.create.mockResolvedValue({ id: 'price_new' });
      stripe.prices.update = jest.fn().mockResolvedValue({});

      const res = await service.repriceTier(tier, 2000, false);

      expect(res.priceId).toBe('price_new');
      expect(stripe.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({ product: 'prod_1', unit_amount: 2000 }),
      );
      // Deactivated, never deleted — historical invoices and grandfathered
      // subscriptions must keep resolving.
      expect(stripe.prices.update).toHaveBeenCalledWith('price_old', { active: false });
    });

    it('grandfathers existing subscribers by default', async () => {
      const stripe = (service as any).stripe;
      stripe.prices.create.mockResolvedValue({ id: 'price_new' });
      stripe.prices.update = jest.fn().mockResolvedValue({});
      prisma.userOrg.findMany = jest.fn();

      const res = await service.repriceTier(tier, 2000, false);

      expect(res.migrated).toBe(0);
      expect(prisma.userOrg.findMany).not.toHaveBeenCalled();
    });

    it('moves subscribers at next renewal, with no mid-cycle proration', async () => {
      const stripe = (service as any).stripe;
      stripe.prices.create.mockResolvedValue({ id: 'price_new' });
      stripe.prices.update = jest.fn().mockResolvedValue({});
      stripe.subscriptions.update = jest.fn().mockResolvedValue({});
      stripe.subscriptions.retrieve.mockResolvedValue({
        id: 'sub_1', items: { data: [{ id: 'si_1' }] },
      });
      prisma.userOrg.findMany = jest.fn().mockResolvedValue([
        { id: 'uo1', stripeSubscriptionId: 'sub_1' },
      ]);

      const res = await service.repriceTier(tier, 2000, true);

      expect(res.migrated).toBe(1);
      expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', {
        items: [{ id: 'si_1', price: 'price_new' }],
        // Without this Stripe bills everyone a prorated amount today.
        proration_behavior: 'none',
      });
    });

    it('keeps going when one subscriber fails to migrate', async () => {
      const stripe = (service as any).stripe;
      stripe.prices.create.mockResolvedValue({ id: 'price_new' });
      stripe.prices.update = jest.fn().mockResolvedValue({});
      stripe.subscriptions.retrieve
        .mockRejectedValueOnce(new Error('no such subscription'))
        .mockResolvedValueOnce({ id: 'sub_2', items: { data: [{ id: 'si_2' }] } });
      stripe.subscriptions.update = jest.fn().mockResolvedValue({});
      prisma.userOrg.findMany = jest.fn().mockResolvedValue([
        { id: 'uo1', stripeSubscriptionId: 'sub_bad' },
        { id: 'uo2', stripeSubscriptionId: 'sub_2' },
      ]);

      const res = await service.repriceTier(tier, 2000, true);

      expect(res.migrated).toBe(1);
    });
  });

  describe('handleWebhook', () => {
    it('should throw BadRequestException on invalid signature', async () => {
      const stripe = (service as any).stripe;
      stripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      await expect(
        service.handleWebhook(Buffer.from('body'), 'bad-sig'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should skip already-processed events (database idempotency)', async () => {
      const stripe = (service as any).stripe;
      stripe.webhooks.constructEvent.mockReturnValue({
        id: 'evt_already_processed',
        type: 'customer.subscription.created',
        data: { object: {} },
      });

      // A concurrent delivery already claimed this id: the insert loses the
      // race on the primary key and Prisma raises P2002.
      const duplicate: any = new Error('Unique constraint failed');
      duplicate.code = 'P2002';
      prisma.webhookEvent.create.mockRejectedValue(duplicate);

      const result = await service.handleWebhook(Buffer.from('body'), 'valid-sig');

      expect(result).toEqual({ received: true });
      // Swallowed as success so Stripe stops redelivering, and the handler
      // must not run a second time.
      expect(prisma.userOrg.update).not.toHaveBeenCalled();
    });

    it('should process subscription.created and record idempotency', async () => {
      const stripe = (service as any).stripe;
      stripe.webhooks.constructEvent.mockReturnValue({
        id: 'evt_new',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_123',
            metadata: { orgId: 'org-1', userId: 'user-1', tierId: 'tier-1' },
          },
        },
      });

      prisma.webhookEvent.create.mockResolvedValue({ id: 'evt_new' });
      prisma.userOrg.update.mockResolvedValue({});

      const result = await service.handleWebhook(Buffer.from('body'), 'valid-sig');

      expect(result).toEqual({ received: true });
      expect(prisma.userOrg.update).toHaveBeenCalledWith({
        where: { userId_orgId: { userId: 'user-1', orgId: 'org-1' } },
        data: {
          stripeSubscriptionId: 'sub_123',
          subscriptionStatus: 'ACTIVE',
          tierId: 'tier-1',
        },
      });
      expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
        data: { id: 'evt_new', source: 'stripe' },
      });
    });

    it('should process subscription.deleted and mark as CANCELED', async () => {
      const stripe = (service as any).stripe;
      stripe.webhooks.constructEvent.mockReturnValue({
        id: 'evt_del',
        type: 'customer.subscription.deleted',
        data: {
          object: { id: 'sub_456', metadata: {} },
        },
      });

      prisma.webhookEvent.create.mockResolvedValue({ id: 'evt_del' });
      prisma.userOrg.findFirst.mockResolvedValue({ id: 'uo-1', userId: 'u1', orgId: 'o1' });
      prisma.userOrg.update.mockResolvedValue({});

      const result = await service.handleWebhook(Buffer.from('body'), 'valid-sig');

      expect(result).toEqual({ received: true });
      expect(prisma.userOrg.update).toHaveBeenCalledWith({
        where: { id: 'uo-1' },
        data: { subscriptionStatus: 'CANCELED' },
      });
    });

    it('should handle unrecognized event types gracefully', async () => {
      const stripe = (service as any).stripe;
      stripe.webhooks.constructEvent.mockReturnValue({
        id: 'evt_unknown',
        type: 'payment_intent.succeeded',
        data: { object: {} },
      });

      prisma.webhookEvent.create.mockResolvedValue({ id: 'evt_unknown' });

      const result = await service.handleWebhook(Buffer.from('body'), 'valid-sig');

      expect(result).toEqual({ received: true });
      expect(prisma.webhookEvent.create).toHaveBeenCalled();
    });

    // Previously asserted the opposite — that a failed handler was still
    // recorded as processed. That behaviour meant Stripe received a 200,
    // never retried, and a paid member was silently left unactivated. The
    // claim now shares the handler's transaction, so a failure rolls it back
    // and the error propagates to produce a non-2xx and a Stripe retry.
    it('should propagate handler failures so Stripe retries', async () => {
      const stripe = (service as any).stripe;
      stripe.webhooks.constructEvent.mockReturnValue({
        id: 'evt_err',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_bad',
            metadata: { orgId: 'org-1', userId: 'user-1' },
          },
        },
      });

      prisma.webhookEvent.create.mockResolvedValue({ id: 'evt_err' });
      prisma.userOrg.update.mockRejectedValue(new Error('DB error'));

      await expect(
        service.handleWebhook(Buffer.from('body'), 'valid-sig'),
      ).rejects.toThrow('DB error');
    });

    it('should claim the event before dispatching, inside one transaction', async () => {
      const stripe = (service as any).stripe;
      stripe.webhooks.constructEvent.mockReturnValue({
        id: 'evt_order',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_order',
            metadata: { orgId: 'org-1', userId: 'user-1', tierId: 'tier-1' },
          },
        },
      });

      const calls: string[] = [];
      prisma.webhookEvent.create.mockImplementation(async () => {
        calls.push('claim');
        return { id: 'evt_order' };
      });
      prisma.userOrg.update.mockImplementation(async () => {
        calls.push('dispatch');
        return {};
      });

      await service.handleWebhook(Buffer.from('body'), 'valid-sig');

      // Claim first: the unique index is the lock a concurrent delivery hits.
      expect(calls).toEqual(['claim', 'dispatch']);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
